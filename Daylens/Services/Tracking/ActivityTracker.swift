import AppKit
import Observation
import OSLog

/// Observes NSWorkspace notifications to track which app is frontmost.
@Observable
final class ActivityTracker {
    private let logger = Logger(subsystem: "com.daylens.app", category: "TrackingPipeline")

    private let database: AppDatabase
    private let frontmostApplicationProvider: () -> (bundleID: String, appName: String)?
    private var currentApp: ActiveAppInfo?
    private var isRunning = false
    private var isPausedForIdle = false
    private var pendingDeactivation: PendingDeactivation?
    private var isSpaceTransitioning = false
    private var spaceTransitionReconcileWorkItem: DispatchWorkItem?
    private var spaceTransitionResetWorkItem: DispatchWorkItem?
    private var workspaceObservers: [NSObjectProtocol] = []
    private let deactivationGracePeriod: TimeInterval
    private let spaceTransitionWindow: TimeInterval

    var trackingState: TrackingState = .idle
    var lastTrackedApp: String?
    var onSessionFinalized: (() -> Void)?

    /// The app that is currently frontmost but whose session has not yet been finalized.
    var currentSessionInfo: (bundleID: String, appName: String, startedAt: Date)? {
        guard let app = currentApp, !isPausedForIdle else { return nil }
        return (app.bundleID, app.appName, app.activatedAt)
    }

    init(
        database: AppDatabase,
        deactivationGracePeriod: TimeInterval = 1.5,
        spaceTransitionWindow: TimeInterval = 2.0,
        frontmostApplicationProvider: @escaping () -> (bundleID: String, appName: String)? = ActivityTracker.defaultFrontmostApplicationInfo
    ) {
        self.database = database
        self.deactivationGracePeriod = deactivationGracePeriod
        self.spaceTransitionWindow = spaceTransitionWindow
        self.frontmostApplicationProvider = frontmostApplicationProvider
    }

    func start() {
        guard !isRunning else { return }
        isRunning = true
        isPausedForIdle = false
        trackingState = .tracking
        logger.info("ActivityTracker started and registering NSWorkspace observers")

        let workspace = NSWorkspace.shared

        // Record the currently active app immediately
        if let frontApp = workspace.frontmostApplication {
            handleAppActivation(frontApp)
        }

        // Observe app activation
        let activateObserver = workspace.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self?.handleAppActivation(app)
        }
        workspaceObservers.append(activateObserver)

        // Observe app deactivation
        let deactivateObserver = workspace.notificationCenter.addObserver(
            forName: NSWorkspace.didDeactivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self?.handleAppDeactivation(app)
        }
        workspaceObservers.append(deactivateObserver)

        let spaceObserver = workspace.notificationCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.handleActiveSpaceDidChange()
        }
        workspaceObservers.append(spaceObserver)

        let terminateObserver = workspace.notificationCenter.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self?.handleAppTermination(app)
        }
        workspaceObservers.append(terminateObserver)
    }

    func stop() {
        logger.info("ActivityTracker stopping")
        finalizePendingDeactivationIfNeeded()
        // Finalize current session
        if let current = currentApp {
            finalizeSession(for: current, endedAt: Date())
            currentApp = nil
        }

        // Remove observers
        for observer in workspaceObservers {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
        workspaceObservers.removeAll()

        pendingDeactivation?.workItem.cancel()
        pendingDeactivation = nil
        spaceTransitionReconcileWorkItem?.cancel()
        spaceTransitionReconcileWorkItem = nil
        spaceTransitionResetWorkItem?.cancel()
        spaceTransitionResetWorkItem = nil
        isSpaceTransitioning = false
        isPausedForIdle = false
        isRunning = false
        trackingState = .idle
    }

    func pauseForIdle() {
        guard isRunning, !isPausedForIdle else { return }
        logger.info("ActivityTracker pausing for idle")

        finalizePendingDeactivationIfNeeded()

        if let current = currentApp {
            finalizeSession(for: current, endedAt: Date())
            currentApp = nil
        } else if let frontApp = NSWorkspace.shared.frontmostApplication {
            currentApp = makeActiveAppInfo(from: frontApp, activatedAt: Date())
        }

        isPausedForIdle = true
        trackingState = .idle
    }

    func resumeFromIdle() {
        guard isRunning, isPausedForIdle else { return }
        logger.info("ActivityTracker resuming after idle")

        pendingDeactivation?.workItem.cancel()
        pendingDeactivation = nil
        isPausedForIdle = false
        trackingState = .tracking

        let resumedAt = Date()
        if let app = currentApp {
            currentApp = nil
            handleAppActivation(
                bundleID: app.bundleID,
                appName: app.appName,
                activatedAt: resumedAt,
                source: .nsworkspace
            )
        } else if let frontApp = NSWorkspace.shared.frontmostApplication {
            handleAppActivation(frontApp)
        }
    }

    private func handleAppActivation(_ app: NSRunningApplication) {
        let bundleID = app.bundleIdentifier ?? "unknown"
        let appName = app.localizedName ?? "Unknown"
        handleAppActivation(bundleID: bundleID, appName: appName, activatedAt: Date(), source: .nsworkspace)
    }

    func simulateFrontmostAppChange(bundleID: String, appName: String, at timestamp: Date) {
        handleAppActivation(bundleID: bundleID, appName: appName, activatedAt: timestamp, source: .nsworkspace)
    }

    func simulateTrackingStarted() {
        isRunning = true
        isPausedForIdle = false
        trackingState = .tracking
        currentApp = nil
        pendingDeactivation?.workItem.cancel()
        pendingDeactivation = nil
    }

    func simulateAppDeactivation(bundleID: String, appName: String, at timestamp: Date) {
        handleAppDeactivation(bundleID: bundleID, appName: appName, deactivatedAt: timestamp)
    }

    func simulateActiveSpaceChange() {
        handleActiveSpaceDidChange()
    }

    func simulateSpaceTransitionFrontmostApp(bundleID: String, appName: String, at timestamp: Date) {
        reconcileFrontmostApplication(
            bundleID: bundleID,
            appName: appName,
            observedAt: timestamp,
            source: .nsworkspace
        )
    }

    private func handleAppActivation(bundleID: String, appName: String, activatedAt: Date, source: ActivityEvent.EventSource) {
        logger.info("Frontmost app changed")

        if isPausedForIdle {
            pendingDeactivation?.workItem.cancel()
            pendingDeactivation = nil
            currentApp = ActiveAppInfo(
                bundleID: bundleID,
                appName: appName,
                windowTitle: nil,
                activatedAt: activatedAt
            )
            lastTrackedApp = appName
            recordActivationEvent(
                bundleID: bundleID,
                appName: appName,
                activatedAt: activatedAt,
                source: source
            )
            return
        }

        if let pending = pendingDeactivation {
            if pending.app.bundleID == bundleID {
                pending.workItem.cancel()
                pendingDeactivation = nil
                currentApp = ActiveAppInfo(
                    bundleID: pending.app.bundleID,
                    appName: appName,
                    windowTitle: pending.app.windowTitle,
                    activatedAt: pending.app.activatedAt
                )
                lastTrackedApp = appName
                logger.debug("Same app reactivated within deactivation grace; continuing session for \(bundleID, privacy: .public)")
                return
            }

            finalizePendingDeactivationIfNeeded()
        }

        if let current = currentApp, current.bundleID == bundleID {
            logger.debug("Ignoring duplicate activation for \(bundleID, privacy: .public)")
            lastTrackedApp = appName
            return
        }

        // If we have a currently tracked app, finalize its session
        if let current = currentApp {
            finalizeSession(for: current, endedAt: activatedAt)
        }

        let newApp = ActiveAppInfo(
            bundleID: bundleID,
            appName: appName,
            windowTitle: nil, // Will be enriched by AccessibilityService
            activatedAt: activatedAt
        )

        currentApp = newApp
        lastTrackedApp = appName
        logger.info("Session started at \(activatedAt.ISO8601Format(), privacy: .public)")

        recordActivationEvent(bundleID: bundleID, appName: appName, activatedAt: activatedAt, source: source)
    }

    private func handleAppDeactivation(_ app: NSRunningApplication) {
        let bundleID = app.bundleIdentifier ?? "unknown"
        let appName = app.localizedName ?? currentApp?.appName ?? "Unknown"
        handleAppDeactivation(bundleID: bundleID, appName: appName, deactivatedAt: Date())
    }

    private func handleAppTermination(_ app: NSRunningApplication) {
        let bundleID = app.bundleIdentifier ?? "unknown"
        guard currentApp?.bundleID == bundleID || pendingDeactivation?.app.bundleID == bundleID else { return }

        let terminatedAt = Date()
        if let pending = pendingDeactivation, pending.app.bundleID == bundleID {
            pending.workItem.cancel()
            pendingDeactivation = nil
            finalizeSession(for: pending.app, endedAt: pending.endedAt)
            currentApp = nil
        } else if let current = currentApp, !isPausedForIdle {
            finalizeSession(for: current, endedAt: terminatedAt)
            currentApp = nil
        } else {
            currentApp = nil
        }

        recordLifecycleEvent(
            type: .appDeactivated,
            bundleID: bundleID,
            appName: app.localizedName ?? "Unknown",
            timestamp: terminatedAt
        )
    }

    private func finalizeSession(for app: ActiveAppInfo, endedAt: Date) {
        let duration = endedAt.timeIntervalSince(app.activatedAt)
        let durationText = String(format: "%.2f", duration)
        logger.info("Session ended, duration: \(durationText, privacy: .public)s")

        // Only persist sessions that meet the minimum threshold
        guard duration >= Constants.minimumUsageDuration else {
            logger.info("Session skipped because duration \(durationText, privacy: .public)s is below the \(Constants.minimumUsageDuration, privacy: .public)s minimum")
            return
        }

        let isPrimaryBrowser = Constants.knownBrowserBundleIDs.contains(app.bundleID)
        let isBrowserCapable = Constants.browserCapableBundleIDs.contains(app.bundleID)
        let category = AppCategory.categorize(bundleID: app.bundleID, appName: app.appName)

        let session = AppSession(
            date: Calendar.current.startOfDay(for: app.activatedAt),
            bundleID: app.bundleID,
            appName: app.appName,
            startTime: app.activatedAt,
            endTime: endedAt,
            duration: duration,
            category: category,
            isBrowser: isPrimaryBrowser
        )

        do {
            try database.insertAppSession(session)
            logger.info("Session written to database (\(durationText, privacy: .public)s)")
            onSessionFinalized?()
        } catch {
            logger.error("Failed to write app session: \(error.localizedDescription, privacy: .private)")
        }

        // Record browser session for all browser-capable apps (primary + hybrid).
        // This captures browsing time in Dia/Atlas for domain intelligence
        // while their app sessions keep their primary category (AI Tools).
        if isBrowserCapable {
            let browserName = Constants.browserNames[app.bundleID] ?? app.appName
            let browserSession = BrowserSession(
                date: Calendar.current.startOfDay(for: app.activatedAt),
                browserBundleID: app.bundleID,
                browserName: browserName,
                startTime: app.activatedAt,
                endTime: endedAt,
                duration: duration
            )
            do {
                try database.insertBrowserSession(browserSession)
            } catch {
                logger.error("Failed to write browser session: \(error.localizedDescription, privacy: .private)")
            }
        }
    }

    /// Update window title for the current app (called by AccessibilityService).
    func updateWindowTitle(_ title: String?) {
        guard let app = currentApp else { return }
        currentApp = ActiveAppInfo(
            bundleID: app.bundleID,
            appName: app.appName,
            windowTitle: title,
            activatedAt: app.activatedAt
        )
    }

    private func handleAppDeactivation(bundleID: String, appName: String, deactivatedAt: Date) {
        guard currentApp?.bundleID == bundleID else { return }

        recordLifecycleEvent(
            type: .appDeactivated,
            bundleID: bundleID,
            appName: appName,
            timestamp: deactivatedAt
        )

        guard !isPausedForIdle, let current = currentApp else { return }

        if let pending = pendingDeactivation, pending.app.bundleID == bundleID {
            return
        }

        schedulePendingDeactivation(for: current, endedAt: deactivatedAt, hintedBySpaceChange: isSpaceTransitioning)
    }

    private func handleActiveSpaceDidChange() {
        isSpaceTransitioning = true
        spaceTransitionReconcileWorkItem?.cancel()
        spaceTransitionResetWorkItem?.cancel()

        let reconcileWorkItem = DispatchWorkItem { [weak self] in
            self?.reconcileCurrentFrontmostApplicationAfterSpaceChange()
        }
        spaceTransitionReconcileWorkItem = reconcileWorkItem
        let reconcileDelay = min(0.3, max(0.05, deactivationGracePeriod / 2))
        DispatchQueue.main.asyncAfter(deadline: .now() + reconcileDelay, execute: reconcileWorkItem)

        let workItem = DispatchWorkItem { [weak self] in
            self?.isSpaceTransitioning = false
        }
        spaceTransitionResetWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + spaceTransitionWindow, execute: workItem)
    }

    private func schedulePendingDeactivation(for app: ActiveAppInfo, endedAt: Date, hintedBySpaceChange: Bool) {
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            guard let pending = self.pendingDeactivation,
                  pending.app.bundleID == app.bundleID,
                  pending.endedAt == endedAt else { return }

            if pending.hintedBySpaceChange {
                self.logger.debug("Finishing deferred deactivation after Space-transition grace expired for \(app.bundleID, privacy: .public)")
            }

            self.finalizeSession(for: pending.app, endedAt: pending.endedAt)
            self.pendingDeactivation = nil
            if self.currentApp?.bundleID == pending.app.bundleID {
                self.currentApp = nil
            }
        }

        pendingDeactivation?.workItem.cancel()
        pendingDeactivation = PendingDeactivation(
            app: app,
            endedAt: endedAt,
            hintedBySpaceChange: hintedBySpaceChange,
            workItem: workItem
        )

        DispatchQueue.main.asyncAfter(deadline: .now() + deactivationGracePeriod, execute: workItem)
    }

    private func reconcileCurrentFrontmostApplicationAfterSpaceChange() {
        guard let frontApp = frontmostApplicationProvider() else { return }
        reconcileFrontmostApplication(
            bundleID: frontApp.bundleID,
            appName: frontApp.appName,
            observedAt: Date(),
            source: .nsworkspace
        )
    }

    private func reconcileFrontmostApplication(
        bundleID: String,
        appName: String,
        observedAt: Date,
        source: ActivityEvent.EventSource
    ) {
        guard isRunning, !isPausedForIdle else { return }

        if let pending = pendingDeactivation, pending.app.bundleID == bundleID {
            logger.debug("Rebinding to frontmost app \(bundleID, privacy: .public) after Space/fullscreen transition")
            handleAppActivation(bundleID: bundleID, appName: appName, activatedAt: observedAt, source: source)
            return
        }

        guard currentApp?.bundleID != bundleID else { return }

        logger.debug("Recovering frontmost app \(bundleID, privacy: .public) after Space/fullscreen transition")
        handleAppActivation(bundleID: bundleID, appName: appName, activatedAt: observedAt, source: source)
    }

    private static func defaultFrontmostApplicationInfo() -> (bundleID: String, appName: String)? {
        guard let frontApp = NSWorkspace.shared.frontmostApplication else { return nil }
        return (
            bundleID: frontApp.bundleIdentifier ?? "unknown",
            appName: frontApp.localizedName ?? "Unknown"
        )
    }

    private func finalizePendingDeactivationIfNeeded() {
        guard let pending = pendingDeactivation else { return }
        pending.workItem.cancel()
        pendingDeactivation = nil
        finalizeSession(for: pending.app, endedAt: pending.endedAt)
        if currentApp?.bundleID == pending.app.bundleID {
            currentApp = nil
        }
    }

    private func makeActiveAppInfo(from app: NSRunningApplication, activatedAt: Date) -> ActiveAppInfo {
        ActiveAppInfo(
            bundleID: app.bundleIdentifier ?? "unknown",
            appName: app.localizedName ?? "Unknown",
            windowTitle: nil,
            activatedAt: activatedAt
        )
    }

    private func recordActivationEvent(
        bundleID: String,
        appName: String,
        activatedAt: Date,
        source: ActivityEvent.EventSource
    ) {
        let event = ActivityEvent(
            timestamp: activatedAt,
            eventType: .appActivated,
            bundleID: bundleID,
            appName: appName,
            isIdle: false,
            confidence: .high,
            source: source
        )
        do {
            try database.insertEvent(event)
        } catch {
            logger.error("Failed to write activation event: \(error.localizedDescription, privacy: .private)")
        }
    }

    private func recordLifecycleEvent(type: ActivityEvent.EventType, app: NSRunningApplication) {
        recordLifecycleEvent(
            type: type,
            bundleID: app.bundleIdentifier ?? "unknown",
            appName: app.localizedName ?? currentApp?.appName ?? "Unknown",
            timestamp: Date()
        )
    }

    private func recordLifecycleEvent(
        type: ActivityEvent.EventType,
        bundleID: String,
        appName: String,
        timestamp: Date
    ) {
        let event = ActivityEvent(
            timestamp: timestamp,
            eventType: type,
            bundleID: bundleID,
            appName: appName,
            isIdle: false,
            confidence: .high,
            source: .nsworkspace
        )

        do {
            try database.insertEvent(event)
        } catch {
            logger.error("Failed to write lifecycle event: \(error.localizedDescription, privacy: .private)")
        }
    }
}

private extension ActivityTracker {
    struct PendingDeactivation {
        let app: ActiveAppInfo
        let endedAt: Date
        let hintedBySpaceChange: Bool
        let workItem: DispatchWorkItem
    }
}
