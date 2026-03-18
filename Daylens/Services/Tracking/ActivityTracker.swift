import AppKit
import Observation

/// Observes NSWorkspace notifications to track which app is frontmost.
@Observable
final class ActivityTracker {
    private let database: AppDatabase
    private var currentApp: ActiveAppInfo?
    private var isRunning = false
    private var workspaceObservers: [NSObjectProtocol] = []

    var trackingState: TrackingState = .idle
    var lastTrackedApp: String?

    init(database: AppDatabase) {
        self.database = database
    }

    func start() {
        guard !isRunning else { return }
        isRunning = true
        trackingState = .tracking

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
    }

    func stop() {
        // Finalize current session
        if let current = currentApp {
            finalizeSession(for: current)
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

        // If we have a currently tracked app, finalize its session
        if let current = currentApp {
            finalizeSession(for: current)
        }

        let newApp = ActiveAppInfo(
            bundleID: bundleID,
            appName: appName,
            windowTitle: nil, // Will be enriched by AccessibilityService
            activatedAt: Date()
        )

        currentApp = newApp
        lastTrackedApp = appName

        // Record raw event
        let event = ActivityEvent(
            timestamp: Date(),
            eventType: .appActivated,
            bundleID: bundleID,
            appName: appName,
            isIdle: false,
            confidence: .high,
            source: .nsworkspace
        )
        try? database.insertEvent(event)
    }

    private func handleAppDeactivation(_ app: NSRunningApplication) {
        let bundleID = app.bundleIdentifier ?? "unknown"
        guard currentApp?.bundleID == bundleID else { return }

        if let current = currentApp {
            finalizeSession(for: current)
        }
        currentApp = nil
    }

    private func finalizeSession(for app: ActiveAppInfo) {
        let duration = Date().timeIntervalSince(app.activatedAt)

        // Only persist sessions that meet the minimum threshold
        guard duration >= Constants.minimumUsageDuration else { return }

        let isBrowser = Constants.knownBrowserBundleIDs.contains(app.bundleID)
        let category = AppCategory.categorize(bundleID: app.bundleID)
        let now = Date()

        let session = AppSession(
            date: Calendar.current.startOfDay(for: app.activatedAt),
            bundleID: app.bundleID,
            appName: app.appName,
            startTime: app.activatedAt,
            endTime: now,
            duration: duration,
            category: category,
            isBrowser: isBrowser
        )

        try? database.insertAppSession(session)

        // Also record as browser session if applicable
        if isBrowser {
            let browserName = Constants.browserNames[app.bundleID] ?? app.appName
            let browserSession = BrowserSession(
                date: Calendar.current.startOfDay(for: app.activatedAt),
                browserBundleID: app.bundleID,
                browserName: browserName,
                startTime: app.activatedAt,
                endTime: now,
                duration: duration
            )
            try? database.insertBrowserSession(browserSession)
        }
    }

    /// Update window title for the current app (called by AccessibilityService).
    func updateWindowTitle(_ title: String?) {
        guard var app = currentApp else { return }
        currentApp = ActiveAppInfo(
            bundleID: app.bundleID,
            appName: app.appName,
            windowTitle: title,
            activatedAt: app.activatedAt
        )
    }
}
