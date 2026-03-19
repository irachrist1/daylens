import Foundation

/// Provides basic local analysis when AI API is unavailable.
enum LocalAnalyzer {
    /// Generate a simple text summary from aggregated data.
    /// Works for any day — does not hardcode "today".
    static func generateLocalSummary(
        appSummaries: [AppUsageSummary],
        websiteSummaries: [WebsiteUsageSummary],
        dailySummary: DailySummary?
    ) -> String {
        // Compute total from sessions directly so this works even without a DailySummary row
        let totalDuration = appSummaries.reduce(0.0) { $0 + $1.totalDuration }
        guard totalDuration > 60 else {
            return "Not enough activity recorded to summarize this day."
        }

        var lines: [String] = []
        let categorySummaries = SemanticUsageRollups.categorySummaries(from: appSummaries)

        let formattedTime = Self.formatDuration(totalDuration)
        lines.append("You were active for \(formattedTime).")

        // Category-level patterns
        if categorySummaries.count >= 2 {
            let top = categorySummaries.prefix(2)
            let parts = top.map { "\($0.category.rawValue) (\($0.formattedDuration))" }
            lines.append("Most of your time went to \(parts.joined(separator: " and ")).")
        } else if let first = categorySummaries.first {
            lines.append("Your time was mainly in \(first.category.rawValue) (\(first.formattedDuration)).")
        }

        // Top app with semantic label
        if let topApp = appSummaries.first {
            let label = topApp.semanticLabel.map { " (\($0))" } ?? ""
            lines.append("Your most-used app was \(topApp.appName)\(label) at \(topApp.formattedDuration).")
        }

        // Top website
        if let topSite = websiteSummaries.first {
            lines.append("Top website: \(topSite.domain) (\(topSite.formattedDuration)).")
        }

        // Focus assessment
        if let summary = dailySummary, summary.focusScore > 0 {
            lines.append("Focus score: \(summary.focusScorePercent)% — \(summary.focusScoreLabel).")

            if summary.contextSwitches > 20 {
                lines.append("You switched between apps \(summary.contextSwitches) times.")
            }

            if summary.longestFocusStreak > 1800 {
                let minutes = Int(summary.longestFocusStreak / 60)
                lines.append("Longest focus streak: \(minutes) minutes.")
            }
        } else {
            // Derive focus from sessions
            let focusedTime = appSummaries
                .filter { $0.classification.category.isFocused }
                .reduce(0.0) { $0 + $1.totalDuration }
            let ratio = totalDuration > 0 ? focusedTime / totalDuration : 0
            let label: String
            switch ratio {
            case 0.8...: label = "Deep Focus"
            case 0.6..<0.8: label = "Focused"
            case 0.4..<0.6: label = "Mixed"
            case 0.2..<0.4: label = "Scattered"
            default: label = "Fragmented"
            }
            lines.append("Focus: \(Int(ratio * 100))% — \(label).")
        }

        return lines.joined(separator: " ")
    }

    private static func formatDuration(_ seconds: TimeInterval) -> String {
        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        if minutes > 0 { return "\(minutes)m" }
        return "\(Int(seconds) % 60)s"
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
