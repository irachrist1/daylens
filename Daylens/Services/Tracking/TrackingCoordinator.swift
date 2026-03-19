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
    private var debouncedSummaryWork: DispatchWorkItem?
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

        // Recompute summary 2 seconds after each app switch
        activityTracker.onSessionFinalized = { [weak self] in
            self?.scheduleDebouncedsummary()
        }

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

        // Compute summary immediately so Today view shows data right away
        computeCurrentDaySummary()

        // Periodic fallback every 15 seconds (session callbacks handle most updates)
        summaryTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
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

    private func scheduleDebouncedsummary() {
        debouncedSummaryWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.computeCurrentDaySummary()
        }
        debouncedSummaryWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
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

            // If it's a browser, try to get the URL via AX API first, then AppleScript fallback
            let bundleID = frontApp.bundleIdentifier ?? ""
            if Constants.knownBrowserBundleIDs.contains(bundleID) {
                var extractedURL: String?
                var extractedTitle: String? = title
                var source: ActivityEvent.EventSource = .accessibility
                var confidence: ActivityEvent.ConfidenceLevel = .medium

                // Layer 1: Accessibility API
                if let axURL = self.accessibilityService.browserAddressBarURL(for: frontApp) {
                    extractedURL = axURL
                    source = .accessibility
                    confidence = .medium
                }

                // Layer 2: AppleScript fallback (higher confidence)
                if extractedURL == nil, let tabInfo = AppleScriptURLProvider.activeTab(for: bundleID) {
                    extractedURL = tabInfo.url
                    extractedTitle = tabInfo.title ?? title
                    source = .accessibility // categorized as local extraction
                    confidence = .high
                }

                if let urlString = extractedURL,
                   let url = URL(string: urlString.hasPrefix("http") ? urlString : "https://\(urlString)"),
                   let host = url.host {
                    let domain = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
                    let visit = WebsiteVisit(
                        date: Calendar.current.startOfDay(for: Date()),
                        domain: domain,
                        fullURL: urlString,
                        pageTitle: extractedTitle,
                        browserBundleID: bundleID,
                        startTime: Date(),
                        endTime: Date().addingTimeInterval(3),
                        duration: 3,
                        confidence: confidence,
                        source: source
                    )
                    try? self.database.insertWebsiteVisit(visit)
                }
            }
        }
    }
}
