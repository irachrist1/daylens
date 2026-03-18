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
                dailySummary = try db.dailySummary(for: date)
                timeline = try db.timelineEvents(for: date)
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

                // Cache the summary
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

    var totalActiveTime: String {
        dailySummary?.formattedActiveTime ?? "0m"
    }

    var focusScoreText: String {
        guard let summary = dailySummary else { return "—" }
        return "\(summary.focusScorePercent)%"
    }

    var focusLabel: String {
        dailySummary?.focusScoreLabel ?? "No data"
    }
}
