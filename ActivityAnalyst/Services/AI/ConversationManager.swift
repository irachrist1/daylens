import Foundation

/// Manages AI conversations with context from tracked activity history.
/// Handles conversation lifecycle, context building, and message persistence.
actor ConversationManager {
    private let aiAnalyst: AIAnalyst
    #if canImport(GRDB)
    private let store: ActivityStore
    #endif

    #if canImport(GRDB)
    init(aiAnalyst: AIAnalyst, store: ActivityStore) {
        self.aiAnalyst = aiAnalyst
        self.store = store
    }
    #else
    init(aiAnalyst: AIAnalyst) {
        self.aiAnalyst = aiAnalyst
    }
    #endif

    /// Processes a user message: builds activity context, queries the AI, returns response.
    func processMessage(
        _ text: String,
        conversationId: UUID,
        dateRange: (from: Date, to: Date)? = nil
    ) async throws -> (response: String, evidence: [EvidenceReference]) {
        let range = dateRange ?? defaultDateRange()
        let context = try await buildContext(from: range.from, to: range.to)

        let (answer, evidence) = try await aiAnalyst.answerQuestion(
            text,
            context: context,
            conversationId: conversationId
        )

        return (response: answer, evidence: evidence)
    }

    /// Generates a daily summary for the given date.
    func generateDailySummary(for date: Date) async throws -> String {
        let start = DateFormatters.startOfDay(date)
        let end = DateFormatters.endOfDay(date)

        #if canImport(GRDB)
        let sessions = try await store.fetchSessions(from: start, to: end, significantOnly: true)
        let appDurations = try await store.appDurations(from: start, to: end)

        let topApps = appDurations.prefix(10).map { item in
            let total = appDurations.reduce(0.0) { $0 + $1.duration }
            return RankedItem(
                id: item.appId,
                name: item.name,
                duration: item.duration,
                category: item.category,
                percentage: total > 0 ? item.duration / total : 0
            )
        }

        let websiteDurations = try await store.websiteDurations(from: start, to: end)
        let topWebsites = websiteDurations.prefix(10).map { item in
            let total = websiteDurations.reduce(0.0) { $0 + $1.duration }
            return RankedItem(
                id: item.websiteId,
                name: item.domain,
                duration: item.duration,
                category: item.category,
                percentage: total > 0 ? item.duration / total : 0
            )
        }

        let totalActive = sessions.reduce(0.0) { $0 + $1.duration }
        let totalIdle = sessions.reduce(0.0) { $0 + $1.idleDuration }
        let switchCount = try await store.switchCount(from: start, to: end)

        let summary = DailySummary(
            date: date,
            totalActiveTime: totalActive,
            totalIdleTime: totalIdle,
            topApps: Array(topApps),
            topBrowsers: [],
            topWebsites: Array(topWebsites),
            focusScore: SessionNormalizer.focusScore(for: sessions),
            fragmentationScore: SessionNormalizer.fragmentationScore(for: sessions),
            sessionCount: sessions.count,
            switchCount: switchCount
        )

        return try await aiAnalyst.generateDailySummary(
            date: date,
            summary: summary,
            topApps: Array(topApps),
            topWebsites: Array(topWebsites)
        )
        #else
        return "AI summary generation requires the full app environment."
        #endif
    }

    // MARK: - Context Building

    private func buildContext(from: Date, to: Date) async throws -> ActivityContext {
        let dateRange = "\(DateFormatters.shortDate.string(from: from)) – \(DateFormatters.shortDate.string(from: to))"

        #if canImport(GRDB)
        let sessions = try await store.fetchSessions(from: from, to: to, significantOnly: true)
        let totalActive = sessions.reduce(0.0) { $0 + $1.duration }

        let appData = try await store.appDurations(from: from, to: to)
        let appDurations = appData.map { ($0.name, $0.duration) }

        let websiteData = try await store.websiteDurations(from: from, to: to)
        let websiteDurations = websiteData.map { ($0.domain, $0.duration) }

        let browserData = try await store.browserDurations(from: from, to: to)
        let browserDurations = browserData.map { ($0.name, $0.duration) }

        let switchCount = try await store.switchCount(from: from, to: to)

        return ActivityContext(
            dateRange: dateRange,
            totalActiveTime: totalActive,
            appDurations: appDurations,
            websiteDurations: websiteDurations,
            browserDurations: browserDurations,
            focusScore: SessionNormalizer.focusScore(for: sessions),
            sessionCount: sessions.count,
            switchCount: switchCount
        )
        #else
        return ActivityContext(
            dateRange: dateRange,
            totalActiveTime: 0,
            appDurations: [],
            websiteDurations: [],
            browserDurations: [],
            focusScore: 0,
            sessionCount: 0,
            switchCount: 0
        )
        #endif
    }

    private func defaultDateRange() -> (from: Date, to: Date) {
        let today = Date()
        return (from: DateFormatters.startOfDay(today), to: DateFormatters.endOfDay(today))
    }
}
