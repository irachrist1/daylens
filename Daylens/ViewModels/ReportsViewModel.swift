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

    // MARK: - Generate weekly report

    func generateWeeklyReport(database: AppDatabase, aiService: AIService) {
        guard !isGenerating else { return }
        isGenerating = true
        generateError = nil

        Task.detached { [weak self] in
            let calendar = Calendar.current
            let today = Date()
            let weekday = calendar.component(.weekday, from: today)
            let daysFromMonday = (weekday + 5) % 7
            let weekStart = calendar.startOfDay(
                for: calendar.date(byAdding: .day, value: -daysFromMonday, to: today)!)

            let summaries = (try? database.recentDailySummaries(limit: 14)) ?? []

            var markdown = ReportGenerator.generateWeeklyReport(
                weekStart: weekStart,
                dailySummaries: summaries
            )

            var aiEnhanced = false
            if aiService.isConfigured {
                let prompt = """
                Improve this weekly activity report. Add specific observations about patterns, progress, and one concrete suggestion for next week. Keep it under 400 words. Return only Markdown.

                \(markdown)
                """
                if let enhanced = try? await aiService.askQuestion(prompt, context: "") {
                    markdown = enhanced
                    aiEnhanced = true
                }
            }

            let weekEnd = calendar.date(byAdding: .day, value: 7, to: weekStart) ?? today
            let report = GeneratedReport(
                id: nil,
                reportType: "weekly",
                periodStart: weekStart,
                periodEnd: weekEnd,
                markdownContent: markdown,
                generatedByAI: aiEnhanced,
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
