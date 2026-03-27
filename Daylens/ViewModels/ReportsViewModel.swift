import Foundation
import Observation

// MARK: - ReportsViewModel

@Observable
final class ReportsViewModel {
    var reports: [GeneratedReport] = []
    var isGenerating: Bool = false
    var generateError: String? = nil

    var dailyReports: [GeneratedReport] {
        reports.filter { $0.reportType == "daily" }
    }

    var weeklyReports: [GeneratedReport] {
        reports.filter { $0.reportType == "weekly" }
    }

    // MARK: - Load

    func loadReports(database: AppDatabase) {
        Task.detached {
            let fetched = (try? database.fetchRecentReports(limit: 30)) ?? []
            await MainActor.run { [weak self] in self?.reports = fetched }
        }
    }

    // MARK: - Generate daily report

    /// Fetches today's data from the DB, generates a markdown report, saves it, and reloads the list.
    func generateDailyReport(database: AppDatabase, aiService: AIService) {
        guard !isGenerating else { return }
        isGenerating = true
        generateError = nil

        Task.detached { [weak self] in
            let today = Date()

            // Fetch today's data
            let payload = try? database.combinedDayPayload(for: today)
            let appSummaries = payload?.appSummaries ?? []
            let websiteSummaries = payload?.websiteSummaries ?? []
            let focusSessions = (try? database.focusSessions(for: today)) ?? []

            let markdownContent = ReportGenerator.generateDailyReport(
                date: today,
                appSummaries: appSummaries,
                workBlocks: [],
                focusSessions: focusSessions,
                websiteSummaries: websiteSummaries
            )

            let report = GeneratedReport(
                id: nil,
                reportType: "daily",
                periodStart: Calendar.current.startOfDay(for: today),
                periodEnd: today,
                markdownContent: markdownContent,
                generatedByAI: false,
                createdAt: today
            )
            try? database.saveReport(report)

            let updated = (try? database.fetchRecentReports(limit: 30)) ?? []
            await MainActor.run { [weak self] in
                self?.reports = updated
                self?.isGenerating = false
            }
        }
    }

    // MARK: - Enhance with AI

    /// Sends an existing report to AI for enhancement, saves the result, and updates the list.
    func enhanceWithAI(_ report: GeneratedReport, database: AppDatabase, aiService: AIService) {
        guard !isGenerating, aiService.isConfigured else { return }
        isGenerating = true

        Task { @MainActor [weak self] in
            defer { self?.isGenerating = false }

            let prompt = """
            Improve this daily activity report. Add 2–3 specific observations and one actionable suggestion. Keep it under 300 words. Return only Markdown.

            \(report.markdownContent)
            """

            guard let enhanced = try? await aiService.askQuestion(prompt, context: "") else { return }

            var updated = report
            updated.markdownContent = enhanced
            updated.generatedByAI = true

            Task.detached {
                try? database.saveReport(updated)
            }

            if let idx = self?.reports.firstIndex(where: { $0.id == report.id }) {
                self?.reports[idx] = updated
            }
        }
    }
}
