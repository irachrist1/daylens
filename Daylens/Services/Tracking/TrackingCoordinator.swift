import AppKit
import Observation

/// Orchestrates all tracking services.
@Observable
final class TrackingCoordinator {
    let activityTracker: ActivityTracker
    let idleDetector: IdleDetector
    let browserHistoryReader: BrowserHistoryReader
    let accessibilityService: AccessibilityService
    let sessionNormalizer: SessionNormalizer
    let permissionManager: PermissionManager

    var trackingState: TrackingState = .idle
    private var summaryTimer: Timer?
    private let database: AppDatabase

    init(database: AppDatabase, permissionManager: PermissionManager) {
        self.database = database
        self.permissionManager = permissionManager
        self.activityTracker = ActivityTracker(database: database)
        self.idleDetector = IdleDetector()
        self.browserHistoryReader = BrowserHistoryReader(database: database)
        self.accessibilityService = AccessibilityService()
        self.sessionNormalizer = SessionNormalizer(database: database)
    }

    func startTracking() {
        // Start core app tracking (always available via NSWorkspace)
        activityTracker.start()
        trackingState = .tracking

        // Start idle detection
        idleDetector.start { [weak self] isIdle in
            guard let self else { return }
            if isIdle {
                // Pause active session tracking
                self.activityTracker.stop()
            } else {
                // Resume tracking
                self.activityTracker.start()
            }
        }

        // Start browser history polling
        browserHistoryReader.startPolling()

        // Start periodic window title reading if accessibility is available
        if AccessibilityService.isAccessibilityEnabled {
            startAccessibilityPolling()
        }

        // Periodic summary computation
        summaryTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.computeCurrentDaySummary()
        }
    }

    func stopTracking() {
        activityTracker.stop()
        idleDetector.stop()
        browserHistoryReader.stopPolling()
        summaryTimer?.invalidate()
        summaryTimer = nil
        trackingState = .paused
    }

    func computeCurrentDaySummary() {
        Task {
            _ = try? sessionNormalizer.computeDailySummary(for: Date())
        }
    }

    // MARK: - Accessibility-based enrichment

    private func startAccessibilityPolling() {
        // When the frontmost app changes, read its window title
        // This is already handled by NSWorkspace observer + AX enrichment
        Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            guard let frontApp = NSWorkspace.shared.frontmostApplication else { return }

            let title = self.accessibilityService.frontmostWindowTitle(for: frontApp)
            self.activityTracker.updateWindowTitle(title)

            // If it's a browser, try to get the URL
            let bundleID = frontApp.bundleIdentifier ?? ""
            if Constants.knownBrowserBundleIDs.contains(bundleID) {
                if let urlString = self.accessibilityService.browserAddressBarURL(for: frontApp),
                   let url = URL(string: urlString.hasPrefix("http") ? urlString : "https://\(urlString)"),
                   let host = url.host {
                    let domain = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
                    let visit = WebsiteVisit(
                        date: Calendar.current.startOfDay(for: Date()),
                        domain: domain,
                        fullURL: urlString,
                        pageTitle: title,
                        browserBundleID: bundleID,
                        startTime: Date(),
                        endTime: Date().addingTimeInterval(3), // Will be refined
                        duration: 3,
                        confidence: .medium,
                        source: .accessibility
                    )
                    try? self.database.insertWebsiteVisit(visit)
                }
            }
        }
    }
}
