import Foundation

/// Provides basic local analysis when AI API is unavailable.
enum LocalAnalyzer {
    /// Generate a simple text summary from aggregated data.
    static func generateLocalSummary(
        appSummaries: [AppUsageSummary],
        websiteSummaries: [WebsiteUsageSummary],
        dailySummary: DailySummary?
    ) -> String {
        guard let summary = dailySummary else {
            return "Not enough data yet. Keep using your Mac and check back later."
        }

        var lines: [String] = []

        lines.append("You were active for \(summary.formattedActiveTime) today.")

        if let topApp = appSummaries.first {
            lines.append("Your most-used app was \(topApp.appName) at \(topApp.formattedDuration).")
        }

        if let topSite = websiteSummaries.first {
            lines.append("You spent the most time on \(topSite.domain) (\(topSite.formattedDuration)).")
        }

        lines.append("Focus score: \(summary.focusScorePercent)% — \(summary.focusScoreLabel).")

        if summary.contextSwitches > 20 {
            lines.append("You switched between apps \(summary.contextSwitches) times — consider batching similar tasks.")
        }

        if summary.longestFocusStreak > 1800 {
            let minutes = Int(summary.longestFocusStreak / 60)
            lines.append("Nice! Your longest focus streak was \(minutes) minutes.")
        }

        return lines.joined(separator: " ")
    }

    /// Answer basic questions locally.
    static func answerLocally(
        question: String,
        appSummaries: [AppUsageSummary],
        websiteSummaries: [WebsiteUsageSummary],
        dailySummary: DailySummary?
    ) -> String? {
        let q = question.lowercased()

        // "How much time on X?"
        if q.contains("how much time") || q.contains("how long") {
            // Check apps
            for app in appSummaries {
                if q.contains(app.appName.lowercased()) {
                    return "You spent \(app.formattedDuration) on \(app.appName) today."
                }
            }
            // Check websites
            for site in websiteSummaries {
                if q.contains(site.domain.lowercased()) {
                    return "You spent \(site.formattedDuration) on \(site.domain) today."
                }
            }
        }

        // "What was my focus score?"
        if q.contains("focus score") || q.contains("focus") {
            if let summary = dailySummary {
                return "Your focus score today is \(summary.focusScorePercent)% — \(summary.focusScoreLabel)."
            }
        }

        // "What did I use the most?"
        if q.contains("most used") || q.contains("top app") {
            if let top = appSummaries.first {
                return "Your most-used app today is \(top.appName) at \(top.formattedDuration)."
            }
        }

        return nil // Can't answer locally
    }
}
