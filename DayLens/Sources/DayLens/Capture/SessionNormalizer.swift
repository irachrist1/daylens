import Foundation

/// Applies all session tracking rules to raw ActivityEvents and produces
/// normalized AppSession / BrowserSession / WebsiteVisit records.
///
/// Rules implemented:
/// 1. App "used" only if frontmost >= 5 seconds (minimumSessionSeconds)
/// 2. Rapid switch merge: same app resuming within 8s merges into previous session
/// 3. Idle: session accrual stops on idleStart, resumes on idleEnd
/// 4. Sub-threshold events stored as ActivityEvents but excluded from sessions
/// 5. Browser-type apps open a BrowserSession in addition to AppSession
/// 6. Private browsing: no domain/title stored on WebsiteVisits
/// 7. Stage Manager debounce: 500ms window before committing activation
final class SessionNormalizer {
    private let activityRepo: ActivityRepository
    private let settings: UserSettings

    // Current state
    private var activeBundleId: String?
    private var activeBundleIdName: String?
    private var sessionStartTime: Double?
    private var lastDeactivationTime: [String: Double] = [:]  // bundleId -> timestamp

    // Debounce for Stage Manager / rapid switching
    private var pendingActivation: (bundleId: String, name: String, timestamp: Double)?
    private var debounceWorkItem: DispatchWorkItem?
    private let debounceInterval: Double = 0.5  // 500ms

    // Open session tracking (in-memory mirror to avoid constant DB reads)
    private var openAppSessionId: [String: String] = [:]      // bundleId -> sessionId
    private var openBrowserSessionId: [String: String] = [:]  // bundleId -> sessionId
    private var openWebsiteVisitId: String?
    private var currentWebsiteDomain: String?
    private var currentWebsiteBrowser: String?

    // Idle state
    private var isIdle = false
    private var idleStartTime: Double?

    init(activityRepo: ActivityRepository, settings: UserSettings) {
        self.activityRepo = activityRepo
        self.settings = settings
    }

    // MARK: - Event ingestion

    func process(_ event: ActivityEvent) {
        // Always persist the raw event
        try? activityRepo.insertEvent(event)

        switch event.type {
        case .appActivated:
            handleActivation(bundleId: event.appBundleId!, name: event.appName!, at: event.timestamp)
        case .appDeactivated:
            handleDeactivation(bundleId: event.appBundleId!, at: event.timestamp)
        case .appTerminated:
            closeSession(for: event.appBundleId!, at: event.timestamp)
        case .websiteVisit:
            handleWebsiteVisit(event)
        case .browserTabChange:
            handleWebsiteVisit(event)
        case .idleStart:
            handleIdleStart(at: event.timestamp)
        case .idleEnd:
            handleIdleEnd(at: event.timestamp)
        default:
            break
        }
    }

    // MARK: - App activation / deactivation

    private func handleActivation(bundleId: String, name: String, at timestamp: Double) {
        // Cancel pending debounce if we get a new activation quickly
        debounceWorkItem?.cancel()

        let workItem = DispatchWorkItem { [weak self] in
            self?.commitActivation(bundleId: bundleId, name: name, at: timestamp)
        }
        debounceWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + debounceInterval, execute: workItem)
    }

    private func commitActivation(bundleId: String, name: String, at timestamp: Double) {
        guard bundleId != activeBundleId else { return }

        // Close previous app session first
        if let prev = activeBundleId {
            closeSession(for: prev, at: timestamp)
        }

        activeBundleId = bundleId
        activeBundleIdName = name

        // Check if we're resuming quickly from last deactivation (merge rule)
        let lastDeact = lastDeactivationTime[bundleId] ?? 0
        let gapSinceLastDeact = timestamp - lastDeact
        let shouldMerge = gapSinceLastDeact > 0 && gapSinceLastDeact <= settings.mergeSwitchGapSeconds

        if shouldMerge, let existingId = openAppSessionId[bundleId],
           var existing = try? activityRepo.openAppSession(for: bundleId) {
            // Continue the existing session — just update startedAt to maintain continuity
            // (gap is already baked in as a brief interruption, no time added for the gap)
            sessionStartTime = timestamp
            // The existing session stays open; we just resumed it
            _ = existingId  // suppress unused warning
            _ = existing    // suppress unused warning
        } else {
            // Open a new session
            let session = AppSession(
                appBundleId: bundleId,
                appName: name,
                startedAt: timestamp
            )
            openAppSessionId[bundleId] = session.id
            try? activityRepo.insertOrUpdateAppSession(session)
            sessionStartTime = timestamp

            // If this is a browser, also open a browser session
            if KnownBrowser.isBrowser(bundleId: bundleId) {
                let browserName = KnownBrowser.from(bundleId: bundleId)?.displayName ?? name
                var bs = BrowserSession(
                    browserBundleId: bundleId,
                    browserName: browserName,
                    startedAt: timestamp
                )
                openBrowserSessionId[bundleId] = bs.id
                try? activityRepo.insertOrUpdateBrowserSession(bs)
            }
        }
    }

    private func handleDeactivation(bundleId: String, at timestamp: Double) {
        lastDeactivationTime[bundleId] = timestamp
        // Don't close immediately — wait for activation of the next app.
        // The close happens in commitActivation -> closeSession(for: prev).
        // However, if no new app activates within debounce window, we just leave it open
        // and the idle detector will eventually clip it.
    }

    // MARK: - Session closing

    private func closeSession(for bundleId: String, at timestamp: Double) {
        guard let sessionId = openAppSessionId[bundleId] else { return }

        let start = sessionStartTime ?? timestamp
        var duration = timestamp - start

        // If we were idle during this session, subtract idle time
        if isIdle, let idleStart = idleStartTime {
            let idleOverlap = timestamp - idleStart
            duration = max(0, duration - idleOverlap)
        }

        // Apply minimum threshold: don't create sessions shorter than minimumSessionSeconds
        if duration < settings.minimumSessionSeconds {
            // Session is too short — remove from open tracking but don't persist a session record
            openAppSessionId.removeValue(forKey: bundleId)
            // (The raw ActivityEvent is already persisted; it just won't show in dashboard)
            return
        }

        // Update the session record with final duration
        if var session = try? activityRepo.openAppSession(for: bundleId) {
            session.endedAt = timestamp
            session.activeDuration = duration
            try? activityRepo.insertOrUpdateAppSession(session)
        }
        openAppSessionId.removeValue(forKey: bundleId)

        // Close browser session if applicable
        closeBrowserSession(for: bundleId, at: timestamp)

        if bundleId == activeBundleId {
            activeBundleId = nil
            activeBundleIdName = nil
            sessionStartTime = nil
        }
    }

    private func closeBrowserSession(for bundleId: String, at timestamp: Double) {
        guard KnownBrowser.isBrowser(bundleId: bundleId),
              let _ = openBrowserSessionId[bundleId],
              var bs = try? activityRepo.openBrowserSession(for: bundleId)
        else { return }

        let duration = timestamp - bs.startedAt
        bs.endedAt = timestamp
        bs.activeDuration = max(0, duration)
        try? activityRepo.insertOrUpdateBrowserSession(bs)
        openBrowserSessionId.removeValue(forKey: bundleId)

        // Also close any open website visit
        closeCurrentWebsiteVisit(at: timestamp)
    }

    // MARK: - Website visits

    func handleWebsiteVisit(_ event: ActivityEvent) {
        guard !settings.isTrackingPaused else { return }
        guard let domain = event.domain,
              let browserName = event.browserName
        else { return }

        // Close previous visit if domain/browser changed
        if let currentDomain = currentWebsiteDomain,
           let currentBrowser = currentWebsiteBrowser,
           (currentDomain != domain || currentBrowser != browserName) {
            closeCurrentWebsiteVisit(at: event.timestamp)
        }

        // Private browsing: apply behavior setting
        if event.isPrivate {
            switch settings.privateBrowsingBehavior {
            case .trackNothing:
                return
            case .trackTimeOnly:
                // Track only browser-level time, no domain
                currentWebsiteDomain = "__private__"
                currentWebsiteBrowser = browserName
                return
            }
        }

        // Open new visit
        let visit = WebsiteVisit(
            domain: domain,
            pageTitle: event.pageTitle,
            urlSlug: event.urlSlug,
            browserName: browserName,
            startedAt: event.timestamp,
            confidence: event.confidence
        )
        openWebsiteVisitId = visit.id
        currentWebsiteDomain = domain
        currentWebsiteBrowser = browserName
        try? activityRepo.insertOrUpdateWebsiteVisit(visit)
    }

    private func closeCurrentWebsiteVisit(at timestamp: Double) {
        guard let domain = currentWebsiteDomain,
              domain != "__private__",
              let browser = currentWebsiteBrowser
        else {
            currentWebsiteDomain = nil
            currentWebsiteBrowser = nil
            openWebsiteVisitId = nil
            return
        }

        if var visit = try? activityRepo.openWebsiteVisit(for: domain, browser: browser) {
            let duration = timestamp - visit.startedAt
            visit.endedAt = timestamp
            visit.duration = max(0, duration)
            try? activityRepo.insertOrUpdateWebsiteVisit(visit)
        }

        currentWebsiteDomain = nil
        currentWebsiteBrowser = nil
        openWebsiteVisitId = nil
    }

    // MARK: - Idle handling

    func handleIdleStart(at timestamp: Double = Date().timeIntervalSince1970) {
        guard !isIdle else { return }
        isIdle = true
        idleStartTime = timestamp
        // Pause accrual: effectively "freeze" the session start times
        // by noting the idle start; duration calculation subtracts idle time at close
    }

    func handleIdleEnd(at timestamp: Double = Date().timeIntervalSince1970) {
        guard isIdle else { return }
        isIdle = false
        idleStartTime = nil
        // Resume: new segment of the existing session begins
        // Reset sessionStartTime so subsequent duration is measured from now
        sessionStartTime = timestamp
    }
}
