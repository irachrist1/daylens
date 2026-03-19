import Foundation
import Observation

/// Lightweight snapshot for a day row in the History list.
struct DaySummarySnapshot: Identifiable {
    let date: Date
    let totalActiveTime: TimeInterval
    let appCount: Int
    let topAppName: String?
    let topAppBundleID: String?

    var id: Date { date }

    var formattedActiveTime: String {
        let hours = Int(totalActiveTime) / 3600
        let minutes = (Int(totalActiveTime) % 3600) / 60
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
    var days: [DaySummarySnapshot] = []
    var selectedDate: Date?
    var isLoadingList: Bool = false

    // Detail state for the selected day
    var appSummaries: [AppUsageSummary] = []
    var websiteSummaries: [WebsiteUsageSummary] = []
    var browserSummaries: [BrowserUsageSummary] = []
    var timeline: [AppSession] = []
    var dailySummary: DailySummary?
    var isLoadingDetail: Bool = false

    // Summary state
    var summaryText: String?
    var isGeneratingSummary: Bool = false

    private var database: AppDatabase? { AppDatabase.shared }

    func loadDays() {
        isLoadingList = true

        Task { @MainActor in
            defer { isLoadingList = false }
            guard let db = database else { return }

            do {
                let trackedDates = try await Task.detached(priority: .userInitiated) {
                    try db.trackedDays(limit: 60)
                }.value

                // Build snapshots for each date
                var snapshots: [DaySummarySnapshot] = []
                for date in trackedDates {
                    if let snapshot = try? db.daySummarySnapshot(for: date) {
                        snapshots.append(snapshot)
                    }
                }
                days = snapshots

                // Auto-select the most recent non-today day, or the first day
                if selectedDate == nil, let first = days.first(where: { !$0.isToday }) ?? days.first {
                    selectedDate = first.date
                    loadDetail(for: first.date)
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
                    (
                        appSummaries: try db.appUsageSummaries(for: date),
                        websiteSummaries: try db.websiteUsageSummaries(for: date),
                        browserSummaries: try db.browserUsageSummaries(for: date),
                        timeline: try db.timelineEvents(for: date),
                        dailySummary: try db.dailySummary(for: date)
                    )
                }.value

                appSummaries = payload.appSummaries
                websiteSummaries = payload.websiteSummaries
                browserSummaries = payload.browserSummaries
                timeline = payload.timeline
                dailySummary = payload.dailySummary

                // Load persisted summary or generate a local one
                if let existing = payload.dailySummary?.aiSummary, !existing.isEmpty {
                    summaryText = existing
                } else if !payload.appSummaries.isEmpty {
                    summaryText = LocalAnalyzer.generateLocalSummary(
                        appSummaries: payload.appSummaries,
                        websiteSummaries: payload.websiteSummaries,
                        dailySummary: payload.dailySummary
                    )
                } else {
                    summaryText = nil
                }
            } catch {
                appSummaries = []
                websiteSummaries = []
                browserSummaries = []
                timeline = []
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

            let context = AIPromptBuilder.buildDayContext(
                date: date,
                appSummaries: appSummaries,
                websiteSummaries: websiteSummaries,
                browserSummaries: browserSummaries,
                dailySummary: dailySummary
            )

            var generatedText: String
            do {
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
                print("[Daylens] Failed to persist AI summary: \(error)")
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

    var categorySummaries: [CategoryUsageSummary] {
        SemanticUsageRollups.categorySummaries(from: appSummaries)
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
}
