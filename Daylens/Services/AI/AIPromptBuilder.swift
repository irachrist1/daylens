import Foundation

/// Builds grounded prompts for the Anthropic API using actual tracked data.
enum AIPromptBuilder {
    static let systemPrompt = """
    You are Daylens, a personal activity analyst for macOS. You analyze the user's \
    computer usage data and provide helpful, grounded insights.

    Rules:
    - Only reference data that is explicitly provided in the context
    - Never invent or hallucinate usage data
    - If you don't have enough data to answer a question, say so clearly
    - Be concise and helpful — write like a thoughtful personal analyst, not a chatbot
    - Use specific numbers (durations, counts) when available
    - When describing patterns, cite the evidence
    - Format durations as "Xh Ym" (e.g., "2h 15m")
    - Be honest about data confidence levels when mentioned
    """

    /// Build context string from tracked data for a specific day.
    static func buildDayContext(
        date: Date,
        appSummaries: [AppUsageSummary],
        websiteSummaries: [WebsiteUsageSummary],
        browserSummaries: [BrowserUsageSummary],
        dailySummary: DailySummary?
    ) -> String {
        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .full

        var context = "## Activity Data for \(dateFormatter.string(from: date))\n\n"

        // Daily overview
        if let summary = dailySummary {
            context += "### Overview\n"
            context += "- Total active time: \(summary.formattedActiveTime)\n"
            context += "- Apps used: \(summary.appCount)\n"
            context += "- Websites visited: \(summary.domainCount)\n"
            context += "- Context switches: \(summary.contextSwitches)\n"
            context += "- Focus score: \(summary.focusScorePercent)% (\(summary.focusScoreLabel))\n"
            context += "- Longest focus streak: \(formatDuration(summary.longestFocusStreak))\n\n"
        }

        // Top apps
        if !appSummaries.isEmpty {
            context += "### Top Apps\n"
            for (i, app) in appSummaries.prefix(10).enumerated() {
                context += "\(i + 1). \(app.appName) — \(app.formattedDuration) (\(app.category.rawValue))\n"
            }
            context += "\n"
        }

        // Top websites
        if !websiteSummaries.isEmpty {
            context += "### Top Websites\n"
            for (i, site) in websiteSummaries.prefix(10).enumerated() {
                let title = site.topPageTitle.map { " (\($0))" } ?? ""
                let confidence = site.confidence == .high ? "" : " [estimated]"
                context += "\(i + 1). \(site.domain)\(title) — \(site.formattedDuration)\(confidence)\n"
            }
            context += "\n"
        }

        // Browsers
        if !browserSummaries.isEmpty {
            context += "### Browsers Used\n"
            for browser in browserSummaries {
                let domains = browser.topDomains.isEmpty ? "" : " (top sites: \(browser.topDomains.joined(separator: ", ")))"
                context += "- \(browser.browserName): \(browser.formattedDuration)\(domains)\n"
            }
            context += "\n"
        }

        return context
    }

    static func dailySummaryPrompt(activityContext: String) -> String {
        """
        Based on the following activity data, write a concise daily summary. \
        Highlight key patterns, the most-used apps and websites, and whether \
        the day was focused or fragmented. Keep it under 200 words.

        \(activityContext)
        """
    }

    static func questionPrompt(question: String, activityContext: String) -> String {
        """
        The user is asking about their activity. Answer based on the data below. \
        If the data doesn't contain enough information to answer, say so.

        \(activityContext)

        User question: \(question)
        """
    }

    private static func formatDuration(_ seconds: TimeInterval) -> String {
        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }
}
