import Foundation
import Observation
import OSLog

/// Lightweight snapshot for a day row in the History list.
struct DaySummarySnapshot: Identifiable {
    let date: Date
    let totalActiveTime: TimeInterval
    let appleLikeTotalActiveTime: TimeInterval
    let appCount: Int
    let topAppName: String?
    let topAppBundleID: String?
    var focusScore: Double = 0      // 0–1; defaults to 0 when daily_summaries row is absent

    var id: Date { date }

    init(
        date: Date,
        totalActiveTime: TimeInterval,
        appleLikeTotalActiveTime: TimeInterval? = nil,
        appCount: Int,
        topAppName: String?,
        topAppBundleID: String?,
        focusScore: Double = 0
    ) {
        self.date = date
        self.totalActiveTime = totalActiveTime
        self.appleLikeTotalActiveTime = appleLikeTotalActiveTime ?? totalActiveTime
        self.appCount = appCount
        self.topAppName = topAppName
        self.topAppBundleID = topAppBundleID
        self.focusScore = focusScore
    }

    var formattedActiveTime: String {
        formattedActiveTime(for: .meaningful)
    }

    func formattedActiveTime(for mode: UsageMetricMode) -> String {
        let value: TimeInterval
        switch mode {
        case .meaningful:
            value = totalActiveTime
        case .appleLike:
            value = appleLikeTotalActiveTime
        }

        let hours = Int(value) / 3600
        let minutes = (Int(value) % 3600) / 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        if minutes > 0 { return "\(minutes)m" }
        return "<1m"
    }

    var isToday: Bool {
        Calendar.current.isDateInToday(date)
    }
}

@Observable
final class HistoryViewModel {
    private let logger = Logger(subsystem: "com.daylens.app", category: "HistoryViewModel")
    var days: [DaySummarySnapshot] = []
    var selectedDate: Date?
    var isLoadingList: Bool = false

    // Detail state for the selected day
    var appSummaries: [AppUsageSummary] = []
    var appleLikeAppSummaries: [AppUsageSummary] = []
    var websiteSummaries: [WebsiteUsageSummary] = []
    var browserSummaries: [BrowserUsageSummary] = []
    var timeline: [AppSession] = []
    var workBlocks: [WorkContextBlock] = []
    var dailySummary: DailySummary?
    var isLoadingDetail: Bool = false
    var usageMetrics = DayUsageMetrics(meaningfulTotal: 0, appleLikeTotal: 0)

    // Summary state
    var summaryText: String?
    var isGeneratingSummary: Bool = false

    private let database: AppDatabase?
    private let blockLabelCache: BlockLabelCache

    init(
        database: AppDatabase? = AppDatabase.shared,
        blockLabelCache: BlockLabelCache = BlockLabelCache()
    ) {
        self.database = database
        self.blockLabelCache = blockLabelCache
    }

    func loadDays() {
        isLoadingList = true

        Task { @MainActor in
            defer { isLoadingList = false }
            guard let db = database else { return }

            do {
                let snapshots = try await Task.detached(priority: .userInitiated) {
                    // trackedDaySnapshots replaces trackedDays + per-day daySummarySnapshot calls
                    // (was 120 individual appUsageSummaries reads for 60 days → 2 SQL queries)
                    try db.trackedDaySnapshots(limit: 60)
                }.value
                days = snapshots

                // Prefer today when it has tracked data; otherwise fall back to the most recent day.
                if selectedDate == nil, let initialSelection = Self.preferredInitialDate(from: days) {
                    selectedDate = initialSelection
                    loadDetail(for: initialSelection)
                }
            } catch {
                days = []
            }
        }
    }

    func selectDay(_ date: Date) {
        guard selectedDate != date else { return }
        selectedDate = date
        loadDetail(for: date)
    }

    func loadDetail(for date: Date) {
        isLoadingDetail = true

        Task { @MainActor in
            defer { isLoadingDetail = false }
            guard let db = database else { return }

            do {
                let payload = try await Task.detached(priority: .userInitiated) {
                    let day = try db.combinedDayPayload(for: date)
                    return (
                        day: day,
                        workBlocks: Self.buildWorkBlocks(
                            from: day.timeline,
                            websiteSummaries: day.websiteSummaries,
                            date: date,
                            blockLabelCache: self.blockLabelCache
                        )
                    )
                }.value

                appSummaries = payload.day.appSummaries
                appleLikeAppSummaries = payload.day.appleLikeAppSummaries
                websiteSummaries = payload.day.websiteSummaries
                browserSummaries = payload.day.browserSummaries
                timeline = payload.day.timeline
                workBlocks = payload.workBlocks
                dailySummary = payload.day.dailySummary
                usageMetrics = payload.day.usageMetrics

                // Load persisted summary or generate a local one
                if let existing = payload.day.dailySummary?.aiSummary, !existing.isEmpty {
                    summaryText = existing
                } else if !payload.day.appSummaries.isEmpty {
                    summaryText = LocalAnalyzer.generateLocalSummary(
                        appSummaries: payload.day.appSummaries,
                        websiteSummaries: payload.day.websiteSummaries,
                        dailySummary: payload.day.dailySummary
                    )
                } else {
                    summaryText = nil
                }
            } catch {
                appSummaries = []
                appleLikeAppSummaries = []
                websiteSummaries = []
                browserSummaries = []
                timeline = []
                workBlocks = []
                dailySummary = nil
                summaryText = nil
            }
        }
    }

    // MARK: - Summary Generation

    /// Whether this day's summary came from the AI (persisted) vs local generation.
    var hasPersistentSummary: Bool {
        dailySummary?.aiSummary?.isEmpty == false
    }

    /// Generate an AI-enhanced summary for the selected day, with local fallback.
    func generateAISummary(aiService: AIService) {
        guard let date = selectedDate, !appSummaries.isEmpty else { return }
        guard !isGeneratingSummary else { return }
        isGeneratingSummary = true

        Task { @MainActor in
            defer { isGeneratingSummary = false }

            var generatedText: String
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
                    generatedText = try await aiService.generateDailySummary(context: context)
                } else {
                    generatedText = LocalAnalyzer.generateLocalSummary(
                        appSummaries: appSummaries,
                        websiteSummaries: websiteSummaries,
                        dailySummary: dailySummary
                    )
                }
            } catch {
                generatedText = LocalAnalyzer.generateLocalSummary(
                    appSummaries: appSummaries,
                    websiteSummaries: websiteSummaries,
                    dailySummary: dailySummary
                )
            }

            // Persist via dedicated raw-SQL upsert — guaranteed to write
            do {
                try database?.saveAISummary(generatedText, for: date)
            } catch {
                // Save failed — summary will still show for this session
                // but won't survive navigation. Log for debugging.
                logger.error("Failed to persist AI summary: \(error.localizedDescription, privacy: .private)")
            }

            // Update in-memory state
            summaryText = generatedText

            // Reload the DailySummary row so hasPersistentSummary reflects the DB
            if let db = database {
                dailySummary = try? db.dailySummary(for: date)
            }
        }
    }

    // MARK: - Computed

    var totalActiveTime: String {
        let total = appSummaries.reduce(0.0) { $0 + $1.totalDuration }
        if total > 0 {
            let hours = Int(total) / 3600
            let minutes = (Int(total) % 3600) / 60
            if hours > 0 { return "\(hours)h \(minutes)m" }
            if minutes > 0 { return "\(minutes)m" }
            return "\(Int(total) % 60)s"
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

    var focusScoreText: String {
        if let summary = dailySummary, summary.focusScore > 0 {
            return "\(summary.focusScorePercent)%"
        }
        let total = appSummaries.reduce(0.0) { $0 + $1.totalDuration }
        guard total > 0 else { return "—" }
        let focusedTime = appSummaries
            .filter { $0.classification.category.isFocused }
            .reduce(0.0) { $0 + $1.totalDuration }
        return "\(Int((focusedTime / total) * 100))%"
    }

    var focusLabel: String {
        if let summary = dailySummary, summary.focusScore > 0 {
            return summary.focusScoreLabel
        }
        let total = appSummaries.reduce(0.0) { $0 + $1.totalDuration }
        guard total > 0 else { return "No data" }
        let ratio = appSummaries
            .filter { $0.classification.category.isFocused }
            .reduce(0.0) { $0 + $1.totalDuration } / total
        switch ratio {
        case 0.8...: return "Deep Focus"
        case 0.6..<0.8: return "Focused"
        case 0.4..<0.6: return "Mixed"
        case 0.2..<0.4: return "Scattered"
        default: return "Fragmented"
        }
    }

    static func preferredInitialDate(from days: [DaySummarySnapshot]) -> Date? {
        if let today = days.first(where: \.isToday) {
            return today.date
        }
        return days.first?.date
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
