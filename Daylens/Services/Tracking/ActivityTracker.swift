import AppKit
import Observation
import OSLog

/// Observes NSWorkspace notifications to track which app is frontmost.
@Observable
final class ActivityTracker {
    private let logger = Logger(subsystem: "com.daylens.app", category: "TrackingPipeline")

    private let database: AppDatabase
    private var currentApp: ActiveAppInfo?
    private var isRunning = false
    private var workspaceObservers: [NSObjectProtocol] = []

    var trackingState: TrackingState = .idle
    var lastTrackedApp: String?
    var onSessionFinalized: (() -> Void)?

    /// The app that is currently frontmost but whose session has not yet been finalized.
    var currentSessionInfo: (bundleID: String, appName: String, startedAt: Date)? {
        guard let app = currentApp else { return nil }
        return (app.bundleID, app.appName, app.activatedAt)
    }

    init(database: AppDatabase) {
        self.database = database
    }

    func start() {
        guard !isRunning else { return }
        isRunning = true
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

        isRunning = false
        trackingState = .idle
    }

    private func handleAppActivation(_ app: NSRunningApplication) {
        let bundleID = app.bundleIdentifier ?? "unknown"
        let appName = app.localizedName ?? "Unknown"
        handleAppActivation(bundleID: bundleID, appName: appName, activatedAt: Date(), source: .nsworkspace)
    }

    func simulateFrontmostAppChange(bundleID: String, appName: String, at timestamp: Date) {
        handleAppActivation(bundleID: bundleID, appName: appName, activatedAt: timestamp, source: .nsworkspace)
    }

    private func handleAppActivation(bundleID: String, appName: String, activatedAt: Date, source: ActivityEvent.EventSource) {
        logger.info("Frontmost app changed")

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

        // Record raw event
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

    private func handleAppDeactivation(_ app: NSRunningApplication) {
        let bundleID = app.bundleIdentifier ?? "unknown"
        guard currentApp?.bundleID == bundleID else { return }

        if let current = currentApp {
            finalizeSession(for: current, endedAt: Date())
        }
        recordLifecycleEvent(type: .appDeactivated, app: app)
        currentApp = nil
    }

    private func handleAppTermination(_ app: NSRunningApplication) {
        let bundleID = app.bundleIdentifier ?? "unknown"
        guard currentApp?.bundleID == bundleID else { return }

        if let current = currentApp {
            finalizeSession(for: current, endedAt: Date())
        }
        recordLifecycleEvent(type: .appDeactivated, app: app)
        currentApp = nil
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

    private func recordLifecycleEvent(type: ActivityEvent.EventType, app: NSRunningApplication) {
        let bundleID = app.bundleIdentifier ?? "unknown"
        let appName = app.localizedName ?? currentApp?.appName ?? "Unknown"
        let event = ActivityEvent(
            timestamp: Date(),
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
