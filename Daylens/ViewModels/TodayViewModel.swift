import Foundation
import Observation

@Observable
final class TodayViewModel {
    var appSummaries: [AppUsageSummary] = []
    var websiteSummaries: [WebsiteUsageSummary] = []
    var browserSummaries: [BrowserUsageSummary] = []
    var dailySummary: DailySummary?
    var timeline: [AppSession] = []
    var aiSummary: String?
    var isLoadingAI: Bool = false
    var isLoading: Bool = false
    var error: String?

    private var database: AppDatabase? { AppDatabase.shared }

    func load(for date: Date) {
        isLoading = true
        error = nil

        Task { @MainActor in
            do {
                guard let db = database else { return }
                appSummaries = try db.appUsageSummaries(for: date)
                websiteSummaries = try db.websiteUsageSummaries(for: date)
                browserSummaries = try db.browserUsageSummaries(for: date)
                timeline = try db.timelineEvents(for: date)
                dailySummary = try db.dailySummary(for: date)
                aiSummary = dailySummary?.aiSummary
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    func generateAISummary(aiService: AIService, for date: Date) {
        isLoadingAI = true

        Task { @MainActor in
            let context = AIPromptBuilder.buildDayContext(
                date: date,
                appSummaries: appSummaries,
                websiteSummaries: websiteSummaries,
                browserSummaries: browserSummaries,
                dailySummary: dailySummary
            )

            do {
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
        if let summary = dailySummary, summary.focusScore > 0 {
            return "\(summary.focusScorePercent)%"
        }
        // Derive from live session data
        let total = appSummaries.reduce(0.0) { $0 + $1.totalDuration }
        guard total > 0 else { return "—" }
        let focusedTime = appSummaries
            .filter { $0.category.isFocused }
            .reduce(0.0) { $0 + $1.totalDuration }
        let pct = Int((focusedTime / total) * 100)
        return "\(pct)%"
    }

    var focusLabel: String {
        if let summary = dailySummary, summary.focusScore > 0 {
            return summary.focusScoreLabel
        }
        let total = appSummaries.reduce(0.0) { $0 + $1.totalDuration }
        guard total > 0 else { return "No data" }
        let focusedTime = appSummaries
            .filter { $0.category.isFocused }
            .reduce(0.0) { $0 + $1.totalDuration }
        let ratio = focusedTime / total
        switch ratio {
        case 0.8...: return "Deep Focus"
        case 0.6..<0.8: return "Focused"
        case 0.4..<0.6: return "Mixed"
        case 0.2..<0.4: return "Scattered"
        default: return "Fragmented"
        }
    }
}
