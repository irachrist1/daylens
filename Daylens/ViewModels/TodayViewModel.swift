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
        isViewingToday = Calendar.current.isDateInToday(date)

        Task { @MainActor in
            do {
                guard let db = database else {
                    isLoading = false
                    return
                }
                // combinedDayPayload runs all day queries in one dbQueue.read and calls
                // meaningfulAppSessions only once (shared between appSummaries and timeline).
                let payload = try await Task.detached(priority: .userInitiated) {
                    (
                        day: try db.combinedDayPayload(for: date),
                        weeklyScores: (try? db.trackedDaySnapshots(limit: 7)) ?? []
                    )
                }.value
                appSummaries = payload.day.appSummaries
                websiteSummaries = payload.day.websiteSummaries
                browserSummaries = payload.day.browserSummaries
                timeline = payload.day.timeline
                dailySummary = payload.day.dailySummary
                weeklyScores = payload.weeklyScores
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
    func injectLiveSession(bundleID: String, appName: String, startedAt: Date) {
        guard isViewingToday else { return }
        let duration = Date().timeIntervalSince(startedAt)
        guard duration >= 3 else { return }
        let category = AppCategory.categorize(bundleID: bundleID, appName: appName)

        if let idx = appSummaries.firstIndex(where: { $0.bundleID == bundleID }) {
            let existing = appSummaries[idx]
            appSummaries[idx] = AppUsageSummary(
                bundleID: existing.bundleID,
                appName: existing.appName,
                totalDuration: existing.totalDuration + duration,
                sessionCount: existing.sessionCount,
                category: existing.category,
                isBrowser: existing.isBrowser
            )
        } else {
            appSummaries.append(AppUsageSummary(
                bundleID: bundleID,
                appName: appName,
                totalDuration: duration,
                sessionCount: 1,
                category: category,
                isBrowser: false
            ))
        }
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
        let ratio = (appFocused + focusedWebCredit) / total
        return min(1.0, ratio)
    }
}
