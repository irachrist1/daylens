import Foundation
import Observation

@Observable
final class TodayViewModel {
    var appSummaries: [AppUsageSummary] = []
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
    private var liveWebsiteBase: [String: TimeInterval] = [:]
    private var cachedOverrides: [String: AppCategory] = [:]
    private let blockLabelCache: BlockLabelCache

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
        liveWebsiteBase = [:]

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
                liveWebsiteBase = [:]
                cachedOverrides = payload.day.categoryOverrides
                appSummaries = payload.day.appSummaries
                websiteSummaries = payload.day.websiteSummaries
                browserSummaries = payload.day.browserSummaries
                timeline = payload.day.timeline
                workBlocks = payload.workBlocks
                dailySummary = payload.day.dailySummary
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
    func injectLiveSession(bundleID: String, appName: String, startedAt: Date) {
        guard isViewingToday else { return }
        let now = Date()
        let liveDuration = now.timeIntervalSince(startedAt)
        guard liveDuration >= 3 else { return }
        let category = cachedOverrides[bundleID] ?? AppCategory.categorize(bundleID: bundleID, appName: appName)
        let isBrowser = Constants.knownBrowserBundleIDs.contains(bundleID)

        if let idx = appSummaries.firstIndex(where: { $0.bundleID == bundleID }) {
            let existing = appSummaries[idx]
            // Latch the DB total on first inject; reuse it on every subsequent call
            // so we always display (dbBase + liveDuration) — not an accumulation.
            let base = liveSessionBase[bundleID, default: existing.totalDuration]
            liveSessionBase[bundleID] = base
            appSummaries[idx] = AppUsageSummary(
                bundleID: existing.bundleID,
                appName: existing.appName,
                totalDuration: base + liveDuration,
                sessionCount: existing.sessionCount,
                category: existing.category,
                isBrowser: existing.isBrowser
            )
        } else {
            // For a brand-new app (no DB sessions yet) the base is 0 — the DB contributed
            // nothing. Latching 0 means subsequent ticks display (0 + freshLiveDuration)
            // rather than (initialLiveDuration + freshLiveDuration) which would double-count.
            liveSessionBase[bundleID] = 0
            appSummaries.append(AppUsageSummary(
                bundleID: bundleID,
                appName: appName,
                totalDuration: liveDuration,
                sessionCount: 1,
                category: category,
                isBrowser: isBrowser
            ))
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
            websiteSummaries[idx] = WebsiteUsageSummary(
                domain: existing.domain,
                totalDuration: base + liveDuration,
                visitCount: existing.visitCount,
                topPageTitle: existing.topPageTitle ?? title ?? url,
                confidence: existing.confidence,
                browserName: existing.browserName
            )
        } else {
            liveWebsiteBase[domain] = 0
            websiteSummaries.append(
                WebsiteUsageSummary(
                    domain: domain,
                    totalDuration: liveDuration,
                    visitCount: 1,
                    topPageTitle: title ?? url,
                    confidence: .medium,
                    browserName: Constants.browserNames[browserBundleID] ?? "Browser"
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
