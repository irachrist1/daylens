import Foundation
import Observation

@Observable
final class TodayViewModel {
    var appSummaries: [AppUsageSummary] = []
    var appleLikeAppSummaries: [AppUsageSummary] = []
    var websiteSummaries: [WebsiteUsageSummary] = []
    var browserSummaries: [BrowserUsageSummary] = []
    var dailySummary: DailySummary?
    var timeline: [AppSession] = []
    var workBlocks: [WorkContextBlock] = []
    var aiSummary: String?
    var isLoadingAI: Bool = false
    var isLoading: Bool = false
    var error: String?

    private let database: AppDatabase?
    /// Stores the DB-loaded base duration for the currently-active live session,
    /// keyed by bundleID. Reset on every fresh load() so the base reflects the
    /// latest DB snapshot. This prevents injectLiveSession from accumulating
    /// duration on top of a previously-injected value each timer tick.
    private var liveSessionBase: [String: TimeInterval] = [:]
    private var liveAppleLikeSessionBase: [String: TimeInterval] = [:]
    private var liveWebsiteBase: [String: TimeInterval] = [:]
    private var liveWebsiteBrowserBase: [String: TimeInterval] = [:]
    private var cachedOverrides: [String: AppCategory] = [:]
    private let blockLabelCache: BlockLabelCache
    var usageMetrics = DayUsageMetrics(meaningfulTotal: 0, appleLikeTotal: 0)

    init(
        database: AppDatabase? = AppDatabase.shared,
        blockLabelCache: BlockLabelCache = BlockLabelCache()
    ) {
        self.database = database
        self.blockLabelCache = blockLabelCache
    }

    func load(for date: Date) {
        isLoading = true
        error = nil
        isViewingToday = Calendar.current.isDateInToday(date)
        liveSessionBase = [:]  // Reset so next inject uses fresh DB totals as base.
        liveAppleLikeSessionBase = [:]
        liveWebsiteBase = [:]
        liveWebsiteBrowserBase = [:]

        Task { @MainActor in
            do {
                guard let db = database else {
                    isLoading = false
                    return
                }
                // combinedDayPayload runs all day queries in one dbQueue.read and calls
                // meaningfulAppSessions only once (shared between appSummaries and timeline).
                let payload = try await Task.detached(priority: .userInitiated) {
                    let day = try db.combinedDayPayload(for: date)
                    return (
                        day: day,
                        weeklyScores: (try? db.trackedDaySnapshots(limit: 7)) ?? [],
                        workBlocks: Self.buildWorkBlocks(
                            from: day.timeline,
                            websiteSummaries: day.websiteSummaries,
                            date: date,
                            blockLabelCache: self.blockLabelCache
                        )
                    )
                }.value
                liveSessionBase = [:]  // Also reset after the async load completes.
                liveAppleLikeSessionBase = [:]
                liveWebsiteBase = [:]
                liveWebsiteBrowserBase = [:]
                cachedOverrides = payload.day.categoryOverrides
                appSummaries = payload.day.appSummaries
                appleLikeAppSummaries = payload.day.appleLikeAppSummaries
                websiteSummaries = payload.day.websiteSummaries
                browserSummaries = payload.day.browserSummaries
                timeline = payload.day.timeline
                workBlocks = payload.workBlocks
                dailySummary = payload.day.dailySummary
                usageMetrics = payload.day.usageMetrics
                weeklyScores = payload.weeklyScores
                aiSummary = dailySummary?.aiSummary
            } catch {
                self.error = error.localizedDescription
                workBlocks = []
            }
            isLoading = false
        }
    }

    func generateAISummary(aiService: AIService, for date: Date) {
        isLoadingAI = true

        Task { @MainActor in
            do {
                let primaryPayload = try database?.aiContextPayload(for: date) ?? AIDayContextPayload(
                    date: date,
                    appSummaries: appSummaries,
                    websiteSummaries: websiteSummaries,
                    browserSummaries: browserSummaries,
                    dailySummary: dailySummary
                )
                let previousDays = (try? database?.recentAIPayloads(endingAt: date, limit: 4)) ?? []
                let context = AIPromptBuilder.buildContext(
                    primaryDay: primaryPayload,
                    previousDays: previousDays
                )

                if aiService.isConfigured {
                    aiSummary = try await aiService.generateDailySummary(context: context)
                } else {
                    aiSummary = LocalAnalyzer.generateLocalSummary(
                        appSummaries: appSummaries,
                        websiteSummaries: websiteSummaries,
                        dailySummary: dailySummary
                    )
                }

                if var summary = dailySummary {
                    summary.aiSummary = aiSummary
                    summary.aiSummaryGeneratedAt = Date()
                    try? database?.saveDailySummary(summary)
                }
            } catch {
                aiSummary = LocalAnalyzer.generateLocalSummary(
                    appSummaries: appSummaries,
                    websiteSummaries: websiteSummaries,
                    dailySummary: dailySummary
                )
            }

            isLoadingAI = false
        }
    }

    /// Merges the currently-active (unfinalised) app session into summaries so the
    /// frontmost app always appears even before the user switches away from it.
    /// Uses a stable DB base duration so repeated timer-tick calls don't compound.
    func injectLiveSession(
        bundleID: String,
        appName: String,
        startedAt: Date,
        includeInMeaningful: Bool = true,
        includeInAppleLike: Bool = true
    ) {
        guard isViewingToday else { return }
        let now = Date()
        let liveDuration = now.timeIntervalSince(startedAt)
        guard liveDuration >= 3 else { return }
        let category = cachedOverrides[bundleID] ?? AppCategory.categorize(bundleID: bundleID, appName: appName)
        let isBrowser = Constants.knownBrowserBundleIDs.contains(bundleID)

        if includeInMeaningful {
            injectLiveSession(
                into: &appSummaries,
                baseStore: &liveSessionBase,
                bundleID: bundleID,
                appName: appName,
                liveDuration: liveDuration,
                category: category,
                isBrowser: isBrowser
            )
        }

        if includeInAppleLike {
            injectLiveSession(
                into: &appleLikeAppSummaries,
                baseStore: &liveAppleLikeSessionBase,
                bundleID: bundleID,
                appName: appName,
                liveDuration: liveDuration,
                category: category,
                isBrowser: isBrowser
            )
        }

        upsertLiveTimelineSession(
            bundleID: bundleID,
            appName: appName,
            startedAt: startedAt,
            category: category,
            isBrowser: isBrowser,
            now: now
        )
        recomputeWorkBlocks(liveSessionStartedAt: startedAt, now: now)
    }

    func injectLiveWebsiteVisit(
        domain: String,
        url: String?,
        title: String?,
        startedAt: Date,
        browserBundleID: String
    ) {
        guard isViewingToday else { return }

        let liveDuration = max(0, Date().timeIntervalSince(startedAt))
        guard liveDuration > 0 else { return }

        if let idx = websiteSummaries.firstIndex(where: { $0.domain == domain }) {
            let existing = websiteSummaries[idx]
            let base = liveWebsiteBase[domain, default: existing.totalDuration]
            liveWebsiteBase[domain] = base
            let browserBreakdowns = updatedBrowserBreakdowns(
                existing.browserBreakdowns,
                domain: domain,
                browserBundleID: browserBundleID,
                title: title ?? url,
                liveDuration: liveDuration
            )
            websiteSummaries[idx] = WebsiteUsageSummary(
                domain: existing.domain,
                totalDuration: base + liveDuration,
                visitCount: existing.visitCount,
                topPageTitle: existing.representativePageTitle ?? title ?? url,
                confidence: existing.confidence,
                browserName: existing.browserName,
                activePageTitle: title ?? url,
                browserBreakdowns: browserBreakdowns
            )
        } else {
            liveWebsiteBase[domain] = 0
            liveWebsiteBrowserBase[websiteBrowserBaseKey(domain: domain, browserBundleID: browserBundleID)] = 0
            websiteSummaries.append(
                WebsiteUsageSummary(
                    domain: domain,
                    totalDuration: liveDuration,
                    visitCount: 1,
                    topPageTitle: title ?? url,
                    confidence: .medium,
                    browserName: Constants.browserNames[browserBundleID] ?? "Browser",
                    activePageTitle: title ?? url,
                    browserBreakdowns: [
                        WebsiteBrowserBreakdown(
                            browserBundleID: browserBundleID,
                            browserName: Constants.browserNames[browserBundleID] ?? "Browser",
                            totalDuration: liveDuration,
                            representativePageTitle: title ?? url,
                            activePageTitle: title ?? url
                        )
                    ]
                )
            )
        }

        websiteSummaries.sort { lhs, rhs in
            if lhs.totalDuration == rhs.totalDuration {
                return lhs.domain.localizedCaseInsensitiveCompare(rhs.domain) == .orderedAscending
            }
            return lhs.totalDuration > rhs.totalDuration
        }

        recomputeWorkBlocks(liveSessionStartedAt: currentLiveSessionStartedAt(), now: Date())
    }

    // MARK: - Greeting

    var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let timeOfDay: String
        switch hour {
        case 5..<12: timeOfDay = "Good morning"
        case 12..<17: timeOfDay = "Good afternoon"
        default: timeOfDay = "Good evening"
        }
        let name = UserDefaults.standard.string(forKey: Constants.DefaultsKey.userName)
            .flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            ?? "there"
        return "\(timeOfDay), \(name)"
    }

    // Computed directly from sessions — never shows 0m while sessions exist
    var totalActiveTime: String {
        let total = appSummaries.reduce(0.0) { $0 + $1.totalDuration }
        if total > 0 {
            let hours = Int(total) / 3600
            let minutes = (Int(total) % 3600) / 60
            if hours > 0 { return "\(hours)h \(minutes)m" }
            if minutes > 0 { return "\(minutes)m" }
            let seconds = Int(total) % 60
            return "\(seconds)s"
        }
        return dailySummary?.formattedActiveTime ?? "0m"
    }

    func totalActiveTime(for mode: UsageMetricMode) -> String {
        let summaries = displayAppSummaries(for: mode)
        let total = summaries.reduce(0.0) { $0 + $1.totalDuration }
        if total > 0 {
            let hours = Int(total) / 3600
            let minutes = (Int(total) % 3600) / 60
            if hours > 0 { return "\(hours)h \(minutes)m" }
            if minutes > 0 { return "\(minutes)m" }
            return "\(Int(total) % 60)s"
        }
        return dailySummary?.formattedActiveTime ?? "0m"
    }

    var focusScoreText: String {
        if !isViewingToday, let summary = dailySummary, summary.focusScore >= 0.01 {
            return "\(summary.focusScorePercent)%"
        }
        let pct = Int(focusScoreRatio * 100)
        guard pct > 0 else { return "—" }
        return "\(pct)%"
    }

    var focusLabel: String {
        if !isViewingToday, let summary = dailySummary, summary.focusScore >= 0.01 {
            return summary.focusScoreLabel
        }
        let total = appSummaries.reduce(0.0) { $0 + $1.totalDuration }
        guard total > 0 else { return "No data" }
        let ratio = focusScoreRatio
        switch ratio {
        case 0.8...: return "Deep Focus"
        case 0.6..<0.8: return "Focused"
        case 0.4..<0.6: return "Mixed"
        case 0.2..<0.4: return "Scattered"
        default: return "Fragmented"
        }
    }

    var categorySummaries: [CategoryUsageSummary] {
        SemanticUsageRollups.categorySummaries(from: appSummaries)
    }

    func displayAppSummaries(for mode: UsageMetricMode) -> [AppUsageSummary] {
        switch mode {
        case .meaningful:
            return appSummaries
        case .appleLike:
            return appleLikeAppSummaries
        }
    }

    var weeklyScores: [DaySummarySnapshot] = []
    private var isViewingToday: Bool = true

    var focusScoreRatio: Double {
        if !isViewingToday, let summary = dailySummary, summary.focusScore >= 0.01 {
            return summary.focusScore
        }
        let total = appSummaries.reduce(0.0) { $0 + $1.totalDuration }
        guard total > 0 else { return 0 }
        let appFocused = appSummaries
            .filter { $0.classification.category.isFocused }
            .reduce(0.0) { $0 + $1.totalDuration }
        // Credit browsing time spent on focused domains (research, dev, AI, writing, productivity)
        let browserTotal = appSummaries
            .filter { $0.category == .browsing }
            .reduce(0.0) { $0 + $1.totalDuration }
        let webFocused = websiteSummaries
            .filter { DomainIntelligence.classify(domain: $0.domain).category.isFocused }
            .reduce(0.0) { $0 + $1.totalDuration }
        let focusedWebCredit = min(webFocused, browserTotal)
        return FocusScoreCalculator.compute(
            focusedTime: appFocused,
            totalTime: total,
            sessionCount: timeline.count,
            websiteFocusCredit: focusedWebCredit
        )
    }

    private func upsertLiveTimelineSession(
        bundleID: String,
        appName: String,
        startedAt: Date,
        category: AppCategory,
        isBrowser: Bool,
        now: Date
    ) {
        let liveSession = AppSession(
            id: nil,
            date: Calendar.current.startOfDay(for: startedAt),
            bundleID: bundleID,
            appName: appName,
            startTime: startedAt,
            endTime: now,
            duration: now.timeIntervalSince(startedAt),
            category: category,
            isBrowser: isBrowser
        )

        if let index = timeline.lastIndex(where: {
            $0.id == nil &&
            $0.bundleID == bundleID &&
            abs($0.startTime.timeIntervalSince(startedAt)) < 1
        }) {
            timeline[index] = liveSession
        } else {
            timeline.append(liveSession)
        }
    }

    private func recomputeWorkBlocks(liveSessionStartedAt: Date?, now: Date) {
        let timelineSnapshot = timeline
        let websiteSummariesSnapshot = websiteSummaries
        let blockLabelCache = blockLabelCache

        Task.detached(priority: .userInitiated) { [self] in
            var blocks = Self.buildWorkBlocks(
                from: timelineSnapshot,
                websiteSummaries: websiteSummariesSnapshot,
                date: now,
                blockLabelCache: blockLabelCache
            )

            if let liveSessionStartedAt,
               let lastBlock = blocks.last {
                let liveDuration = max(0, now.timeIntervalSince(liveSessionStartedAt))
                if liveDuration > 0,
                   now.timeIntervalSince(lastBlock.endTime) <= (2 * liveDuration) {
                    blocks[blocks.count - 1] = lastBlock.with(isLive: true)
                }
            }

            let finalBlocks = blocks
            await MainActor.run {
                self.workBlocks = finalBlocks
            }
        }
    }

    private func currentLiveSessionStartedAt() -> Date? {
        timeline.last(where: { $0.id == nil })?.startTime
    }

    private func injectLiveSession(
        into summaries: inout [AppUsageSummary],
        baseStore: inout [String: TimeInterval],
        bundleID: String,
        appName: String,
        liveDuration: TimeInterval,
        category: AppCategory,
        isBrowser: Bool
    ) {
        if let idx = summaries.firstIndex(where: { $0.bundleID == bundleID }) {
            let existing = summaries[idx]
            let base = baseStore[bundleID, default: existing.totalDuration]
            baseStore[bundleID] = base
            summaries[idx] = AppUsageSummary(
                bundleID: existing.bundleID,
                appName: existing.appName,
                totalDuration: base + liveDuration,
                sessionCount: existing.sessionCount,
                category: existing.category,
                isBrowser: existing.isBrowser
            )
        } else {
            baseStore[bundleID] = 0
            summaries.append(AppUsageSummary(
                bundleID: bundleID,
                appName: appName,
                totalDuration: liveDuration,
                sessionCount: 1,
                category: category,
                isBrowser: isBrowser
            ))
        }

        summaries.sort { lhs, rhs in
            if lhs.totalDuration == rhs.totalDuration {
                return lhs.appName.localizedCaseInsensitiveCompare(rhs.appName) == .orderedAscending
            }
            return lhs.totalDuration > rhs.totalDuration
        }
    }

    private func updatedBrowserBreakdowns(
        _ breakdowns: [WebsiteBrowserBreakdown],
        domain: String,
        browserBundleID: String,
        title: String?,
        liveDuration: TimeInterval
    ) -> [WebsiteBrowserBreakdown] {
        let browserName = Constants.browserNames[browserBundleID] ?? "Browser"
        let key = websiteBrowserBaseKey(domain: domain, browserBundleID: browserBundleID)

        if let existingBreakdown = breakdowns.first(where: { $0.browserBundleID == browserBundleID }) {
            let base = liveWebsiteBrowserBase[key, default: existingBreakdown.totalDuration]
            liveWebsiteBrowserBase[key] = base

            return breakdowns.map { breakdown in
                guard breakdown.browserBundleID == browserBundleID else { return breakdown }
                return WebsiteBrowserBreakdown(
                    browserBundleID: breakdown.browserBundleID,
                    browserName: breakdown.browserName,
                    totalDuration: base + liveDuration,
                    representativePageTitle: breakdown.representativePageTitle,
                    activePageTitle: title
                )
            }
        }

        liveWebsiteBrowserBase[key] = 0
        return breakdowns + [
            WebsiteBrowserBreakdown(
                browserBundleID: browserBundleID,
                browserName: browserName,
                totalDuration: liveDuration,
                representativePageTitle: title,
                activePageTitle: title
            )
        ]
    }

    private func websiteBrowserBaseKey(domain: String, browserBundleID: String) -> String {
        "\(domain)||\(browserBundleID)"
    }

    private static func buildWorkBlocks(
        from timeline: [AppSession],
        websiteSummaries: [WebsiteUsageSummary],
        date: Date,
        blockLabelCache: BlockLabelCache
    ) -> [WorkContextBlock] {
        let groupedBlocks = WorkContextGrouper.group(
            sessions: timeline,
            websiteSummaries: websiteSummaries
        )

        return groupedBlocks.map { block in
            let browserNames = Set(block.sessions.compactMap { session -> String? in
                guard Constants.browserCapableBundleIDs.contains(session.bundleID) else {
                    return nil
                }
                return Constants.browserNames[session.bundleID] ?? session.appName
            })

            let aiLabel = blockLabelCache.loadCachedLabel(for: block, date: date)

            guard !browserNames.isEmpty else { return block.with(aiLabel: aiLabel) }
            let websites = websiteSummaries.filter { browserNames.contains($0.browserName) }
            return block.with(websites: websites, aiLabel: aiLabel)
        }
    }
}
