import AppKit
import Observation
import OSLog

/// Orchestrates all tracking services.
@Observable
final class TrackingCoordinator {
    private let logger = Logger(subsystem: "com.daylens.app", category: "TrackingCoordinator")
    private static let summaryRepairFlag = "daylens_v2_summaries_recomputed"

    let activityTracker: ActivityTracker
    let idleDetector: IdleDetector
    let browserHistoryReader: BrowserHistoryReader
    let accessibilityService: AccessibilityService
    let sessionNormalizer: SessionNormalizer
    let permissionManager: PermissionManager

    var trackingState: TrackingState = .idle

    /// Forwards the in-flight session from the underlying activity tracker.
    var currentSessionInfo: (bundleID: String, appName: String, startedAt: Date)? {
        activityTracker.currentSessionInfo
    }
    var currentWebVisitInfo: (domain: String, url: String?, title: String?, startedAt: Date, browserBundleID: String)? {
        guard let domain = currentWebDomain,
              let start = currentWebVisitStart,
              let bundleID = currentWebBundleID else { return nil }
        return (domain, currentWebURL, currentWebTitle, start, bundleID)
    }
    private var summaryTimer: Timer?
    private var accessibilityTimer: Timer?
    private var debouncedSummaryWork: DispatchWorkItem?
    private let database: AppDatabase

    // Current website visit state — we track one open "session" and finalize on domain change
    private var currentWebDomain: String?
    private var currentWebVisitStart: Date?
    private var currentWebURL: String?
    private var currentWebTitle: String?
    private var currentWebBundleID: String?
    private var currentWebConfidence: ActivityEvent.ConfidenceLevel = .medium
    private var webExtractionFailures = 0
    private var isPausedForSystemIdle = false
    private var isHoldingFullscreenIdleSession = false

    init(database: AppDatabase, permissionManager: PermissionManager) {
        self.database = database
        self.permissionManager = permissionManager
        self.activityTracker = ActivityTracker(database: database)
        self.idleDetector = IdleDetector()
        self.browserHistoryReader = BrowserHistoryReader(database: database)
        self.accessibilityService = AccessibilityService()
        self.sessionNormalizer = SessionNormalizer(database: database)
    }

    deinit {
        stopTracking()
    }

    func startTracking() {
        guard trackingState != .tracking else {
            logger.debug("startTracking ignored because tracking is already active")
            return
        }

        logger.info("TrackingCoordinator starting tracking pipeline")

        // Start core app tracking (always available via NSWorkspace)
        activityTracker.start()
        trackingState = .tracking

        // Recompute summary 2 seconds after each app switch
        activityTracker.onSessionFinalized = { [weak self] in
            self?.scheduleDebouncedsummary()
        }

        // Start idle detection
        idleDetector.start { [weak self] isIdle in
            self?.handleIdleStateChange(isIdle)
        }

        // Start browser history polling
        browserHistoryReader.startPolling()

        // AppleScript fallback works without Accessibility permission, so always poll.
        startAccessibilityPolling()

        // Compute summary immediately so Today view shows data right away
        computeCurrentDaySummary()
        recomputeHistoricalDailySummariesIfNeeded()

        // Periodic fallback every 15 seconds (session callbacks handle most updates)
        summaryTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            self?.computeCurrentDaySummary()
        }
    }

    func stopTracking() {
        logger.info("TrackingCoordinator stopping tracking pipeline")
        finalizeCurrentWebVisit()
        activityTracker.stop()
        activityTracker.onSessionFinalized = nil
        idleDetector.stop()
        browserHistoryReader.stopPolling()
        summaryTimer?.invalidate()
        summaryTimer = nil
        accessibilityTimer?.invalidate()
        accessibilityTimer = nil
        debouncedSummaryWork?.cancel()
        debouncedSummaryWork = nil
        isPausedForSystemIdle = false
        isHoldingFullscreenIdleSession = false
        trackingState = .paused
    }

    func computeCurrentDaySummary() {
        Task.detached(priority: .utility) { [sessionNormalizer] in
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

    private func recomputeHistoricalDailySummariesIfNeeded() {
        guard !UserDefaults.standard.bool(forKey: Self.summaryRepairFlag) else { return }

        let sessionNormalizer = sessionNormalizer
        let logger = logger
        Task.detached(priority: .utility) {
            do {
                try sessionNormalizer.recomputeAllDailySummaries()
                UserDefaults.standard.set(true, forKey: Self.summaryRepairFlag)
                logger.info("Historical daily summaries recomputed after tracking engine update")
            } catch {
                logger.error("Failed to recompute historical daily summaries: \(error.localizedDescription, privacy: .private)")
            }
        }
    }

    func handleIdleStateChange(_ isIdle: Bool, keepTrackingDuringIdle: Bool? = nil) {
        if isIdle {
            if keepTrackingDuringIdle ?? shouldKeepTrackingDuringSystemIdle() {
                if !isHoldingFullscreenIdleSession {
                    logger.info("Idle detected while the frontmost window is fullscreen; keeping the passive session open")
                }
                isHoldingFullscreenIdleSession = true
                return
            }

            pauseForSystemIdleIfNeeded()
            return
        }

        if isHoldingFullscreenIdleSession {
            logger.info("User activity resumed; clearing fullscreen idle hold")
        }

        isHoldingFullscreenIdleSession = false
        resumeAfterSystemIdleIfNeeded()
    }

    @discardableResult
    func refreshIdleSuppressionIfNeeded(keepTrackingDuringIdle: Bool) -> Bool {
        guard idleDetector.isIdle else {
            isHoldingFullscreenIdleSession = false
            return false
        }

        if keepTrackingDuringIdle {
            if !isHoldingFullscreenIdleSession {
                logger.info("Maintaining tracking while fullscreen content remains frontmost during system idle")
            }
            isHoldingFullscreenIdleSession = true
            return false
        }

        guard isHoldingFullscreenIdleSession else { return false }

        logger.info("Fullscreen idle hold ended; pausing tracking because the frontmost window is no longer fullscreen")
        isHoldingFullscreenIdleSession = false
        pauseForSystemIdleIfNeeded()
        return true
    }

    // MARK: - Accessibility-based enrichment

    private func startAccessibilityPolling() {
        accessibilityTimer?.invalidate()
        accessibilityTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            let frontApp = NSWorkspace.shared.frontmostApplication
            let shouldKeepTrackingDuringIdle = self.shouldKeepTrackingDuringSystemIdle(frontApp: frontApp)
            if self.refreshIdleSuppressionIfNeeded(keepTrackingDuringIdle: shouldKeepTrackingDuringIdle) {
                return
            }

            guard let frontApp else { return }

            let title = self.accessibilityService.frontmostWindowTitle(for: frontApp)
            self.activityTracker.updateWindowTitle(title)

            // If it's browser-capable (primary or hybrid), try URL extraction
            let bundleID = frontApp.bundleIdentifier ?? ""
            guard BrowserRegistry.shared.isBrowserCapable(bundleID) else {
                // Non-browser became frontmost — finalize any open website visit
                self.webExtractionFailures = 0
                self.finalizeCurrentWebVisit()
                return
            }

            var extractedURL: String?
            var extractedTitle: String? = title
            var confidence: ActivityEvent.ConfidenceLevel = .medium

            // Layer 1: Accessibility API
            if let axURL = self.accessibilityService.browserAddressBarURL(for: frontApp) {
                extractedURL = axURL
                confidence = .medium
            }

            // Layer 2: AppleScript fallback (higher confidence)
            if extractedURL == nil, let tabInfo = AppleScriptURLProvider.activeTab(for: bundleID) {
                extractedURL = tabInfo.url
                extractedTitle = tabInfo.title ?? title
                confidence = .high
            }

            guard let urlString = extractedURL,
                  let url = URL(string: urlString.hasPrefix("http") ? urlString : "https://\(urlString)"),
                  let host = url.host else {
                self.webExtractionFailures += 1

                if let currentBundleID = self.currentWebBundleID, currentBundleID != bundleID {
                    self.finalizeCurrentWebVisit()
                    return
                }

                if self.currentWebBundleID == bundleID, self.currentWebDomain != nil {
                    // Full-screen browser playback can temporarily hide the address bar and
                    // break both AX + AppleScript URL extraction even though the user is
                    // still on the same site. Keep the current visit open until the browser
                    // actually loses focus or we positively observe a new domain.
                    if let newTitle = extractedTitle, self.currentWebTitle == nil {
                        self.currentWebTitle = newTitle
                    }
                    return
                }

                if self.webExtractionFailures >= 3 {
                    self.finalizeCurrentWebVisit()
                }
                return
            }

            self.webExtractionFailures = 0
            let domain = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host

            if domain == self.currentWebDomain, bundleID == self.currentWebBundleID {
                // Same site in the same browser — update title if we got a better one
                if let newTitle = extractedTitle, self.currentWebTitle == nil {
                    self.currentWebTitle = newTitle
                }
                // Promote confidence if we got a higher-quality extraction
                if confidence == .high {
                    self.currentWebConfidence = .high
                }
            } else {
                // Domain or browser changed — finalize previous, start new session
                self.finalizeCurrentWebVisit()
                self.currentWebDomain = domain
                self.currentWebVisitStart = Date()
                self.currentWebURL = urlString
                self.currentWebTitle = extractedTitle
                self.currentWebBundleID = bundleID
                self.currentWebConfidence = confidence
            }
        }
    }

    /// Finalize the current website visit session and persist it.
    private func finalizeCurrentWebVisit() {
        guard let domain = currentWebDomain,
              let startTime = currentWebVisitStart,
              let bundleID = currentWebBundleID else {
            clearWebVisitState()
            return
        }

        let endTime = Date()
        let duration = endTime.timeIntervalSince(startTime)

        // Only persist if the visit lasted long enough
        guard duration >= Constants.minimumWebsiteVisitDuration else {
            clearWebVisitState()
            return
        }

        let visit = WebsiteVisit(
            date: Calendar.current.startOfDay(for: startTime),
            domain: domain,
            fullURL: currentWebURL,
            pageTitle: currentWebTitle,
            browserBundleID: bundleID,
            startTime: startTime,
            endTime: endTime,
            duration: duration,
            confidence: currentWebConfidence,
            source: .accessibility
        )
        try? database.insertWebsiteVisit(visit)
        clearWebVisitState()
    }

    private func clearWebVisitState() {
        currentWebDomain = nil
        currentWebVisitStart = nil
        currentWebURL = nil
        currentWebTitle = nil
        currentWebBundleID = nil
        currentWebConfidence = .medium
        webExtractionFailures = 0
    }

    private func shouldKeepTrackingDuringSystemIdle(frontApp: NSRunningApplication? = NSWorkspace.shared.frontmostApplication) -> Bool {
        guard let frontApp else { return false }
        return accessibilityService.isFrontmostWindowFullScreen(for: frontApp)
    }

    private func pauseForSystemIdleIfNeeded() {
        guard !isPausedForSystemIdle else { return }

        logger.info("Idle detected; pausing activity tracker")
        finalizeCurrentWebVisit()
        activityTracker.pauseForIdle()
        isPausedForSystemIdle = true
    }

    private func resumeAfterSystemIdleIfNeeded() {
        guard isPausedForSystemIdle else { return }

        logger.info("Idle cleared; resuming activity tracker")
        activityTracker.resumeFromIdle()
        isPausedForSystemIdle = false
    }
}
