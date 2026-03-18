import Foundation

/// Assigns activity categories to apps, websites, and sessions.
/// Uses a combination of known mappings and heuristic rules.
final class CategoryClassifier {

    /// Classifies a session based on its app and website context.
    func classify(
        session: Session,
        app: AppRecord?,
        website: WebsiteRecord?
    ) -> ActivityCategory {
        if let website = website, website.category != .uncategorized {
            return website.category
        }

        if let app = app, app.category != .uncategorized {
            return app.category
        }

        return .uncategorized
    }

    /// Batch-classifies sessions by resolving their app and website references.
    func classifySessions(
        _ sessions: [Session],
        apps: [UUID: AppRecord],
        websites: [UUID: WebsiteRecord]
    ) -> [Session] {
        sessions.map { session in
            var updated = session
            let app = apps[session.appId]
            let website = session.websiteId.flatMap { websites[$0] }
            updated.category = classify(session: session, app: app, website: website)
            return updated
        }
    }

    /// Suggests a category for an unknown app based on its bundle identifier.
    func suggestCategory(for bundleId: String) -> ActivityCategory {
        AppRecord.inferCategory(for: bundleId)
    }

    /// Suggests a category for an unknown domain.
    func suggestCategory(forDomain domain: String) -> ActivityCategory {
        WebsiteRecord.inferCategory(for: domain)
    }
}

// MARK: - Daily Summary Builder

/// Builds DailySummary from a day's worth of sessions.
struct DailySummaryBuilder {
    let date: Date
    let sessions: [Session]
    let apps: [UUID: AppRecord]
    let browsers: [UUID: BrowserRecord]
    let websites: [UUID: WebsiteRecord]

    func build() -> DailySummary {
        let significantSessions = sessions.filter { $0.isSignificant }
        let totalActive = significantSessions.reduce(0.0) { $0 + $1.duration }
        let totalIdle = significantSessions.reduce(0.0) { $0 + $1.idleDuration }

        let topApps = buildTopApps(from: significantSessions, total: totalActive)
        let topBrowsers = buildTopBrowsers(from: significantSessions, total: totalActive)
        let topWebsites = buildTopWebsites(from: significantSessions, total: totalActive)

        let focusScore = SessionNormalizer.focusScore(for: significantSessions)
        let fragScore = SessionNormalizer.fragmentationScore(for: significantSessions)

        let switchCount = countSwitches(in: significantSessions)

        return DailySummary(
            date: date,
            totalActiveTime: totalActive,
            totalIdleTime: totalIdle,
            topApps: topApps,
            topBrowsers: topBrowsers,
            topWebsites: topWebsites,
            focusScore: focusScore,
            fragmentationScore: fragScore,
            sessionCount: significantSessions.count,
            switchCount: switchCount,
            generatedAt: Date()
        )
    }

    private func buildTopApps(from sessions: [Session], total: TimeInterval) -> [RankedItem] {
        var appDurations: [UUID: (duration: TimeInterval, count: Int)] = [:]

        for session in sessions {
            let existing = appDurations[session.appId] ?? (0, 0)
            appDurations[session.appId] = (existing.duration + session.duration, existing.count + 1)
        }

        return appDurations
            .sorted { $0.value.duration > $1.value.duration }
            .prefix(TrackingRules.dashboardTopN)
            .map { appId, stats in
                let app = apps[appId]
                return RankedItem(
                    id: appId,
                    name: app?.name ?? "Unknown",
                    duration: stats.duration,
                    category: app?.category ?? .uncategorized,
                    sessionCount: stats.count,
                    percentage: total > 0 ? stats.duration / total : 0
                )
            }
    }

    private func buildTopBrowsers(from sessions: [Session], total: TimeInterval) -> [RankedItem] {
        var browserDurations: [UUID: (duration: TimeInterval, count: Int)] = [:]

        for session in sessions where session.browserId != nil {
            let bid = session.browserId!
            let existing = browserDurations[bid] ?? (0, 0)
            browserDurations[bid] = (existing.duration + session.duration, existing.count + 1)
        }

        return browserDurations
            .sorted { $0.value.duration > $1.value.duration }
            .prefix(TrackingRules.dashboardTopN)
            .map { browserId, stats in
                let browser = browsers[browserId]
                return RankedItem(
                    id: browserId,
                    name: browser?.name ?? "Unknown Browser",
                    duration: stats.duration,
                    category: .reference,
                    sessionCount: stats.count,
                    percentage: total > 0 ? stats.duration / total : 0
                )
            }
    }

    private func buildTopWebsites(from sessions: [Session], total: TimeInterval) -> [RankedItem] {
        var websiteDurations: [UUID: (duration: TimeInterval, count: Int)] = [:]

        for session in sessions where session.websiteId != nil {
            let wid = session.websiteId!
            let existing = websiteDurations[wid] ?? (0, 0)
            websiteDurations[wid] = (existing.duration + session.duration, existing.count + 1)
        }

        return websiteDurations
            .sorted { $0.value.duration > $1.value.duration }
            .prefix(TrackingRules.dashboardTopN)
            .map { websiteId, stats in
                let website = websites[websiteId]
                return RankedItem(
                    id: websiteId,
                    name: website?.domain ?? "Unknown",
                    duration: stats.duration,
                    category: website?.category ?? .uncategorized,
                    sessionCount: stats.count,
                    percentage: total > 0 ? stats.duration / total : 0
                )
            }
    }

    private func countSwitches(in sessions: [Session]) -> Int {
        guard sessions.count > 1 else { return 0 }
        let sorted = sessions.sorted { $0.startTime < $1.startTime }
        var switches = 0
        for i in 1..<sorted.count {
            if sorted[i].appId != sorted[i - 1].appId {
                switches += 1
            }
        }
        return switches
    }
}
