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
    - Prefer supported category-level patterns (for example Development, AI Tools, Writing) over repeating raw app names alone
    - Treat semantic labels as deterministic app-purpose hints, not proof of the exact task the user performed

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
        let categorySummaries = SemanticUsageRollups.categorySummaries(from: appSummaries)

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

        if !categorySummaries.isEmpty {
            context += "### Category Breakdown\n"
            for (index, category) in categorySummaries.enumerated() {
                let lowConfidenceNote = category.containsLowConfidenceApps ? " [includes uncertain app mappings]" : ""
                let topApps = category.topApps.isEmpty ? "" : " | top apps: \(category.topApps.joined(separator: ", "))"
                context += "\(index + 1). \(category.category.rawValue) — \(category.formattedDuration) across \(category.appCount) app(s), \(category.sessionCount) session(s)\(topApps)\(lowConfidenceNote)\n"
            }
            context += "\n"
        }

        // Top apps
        if !appSummaries.isEmpty {
            context += "### Top Apps\n"
            for (i, app) in appSummaries.prefix(10).enumerated() {
                let semantic = app.semanticLabel.map { " | type: \($0)" } ?? ""
                let confidence = app.classificationConfidence == .high ? "" : " | category confidence: \(app.classificationConfidence.rawValue.lowercased())"
                context += "\(i + 1). \(app.appName) — \(app.formattedDuration) | category: \(app.category.rawValue)\(semantic) | sessions: \(app.sessionCount)\(confidence)\n"
            }
            context += "\n"
        }

        // Top websites with domain intelligence grouping
        if !websiteSummaries.isEmpty {
            let grouped = DomainIntelligence.groupedSummaries(from: websiteSummaries)
            if !grouped.isEmpty {
                context += "### Top Sites (grouped)\n"
                for (i, group) in grouped.prefix(10).enumerated() {
                    let subtitle = group.domainCount > 1 ? " (\(group.domainCount) subdomains)" : ""
                    let category = group.category != .uncategorized ? " | type: \(group.category.rawValue)" : ""
                    context += "\(i + 1). \(group.siteGroup)\(subtitle) — \(group.formattedDuration)\(category)\n"
                }
                context += "\n"
            }

            context += "### Top Websites (detail)\n"
            for (i, site) in websiteSummaries.prefix(10).enumerated() {
                let title = site.topPageTitle.map { " (\($0))" } ?? ""
                let confidence = site.confidence == .high ? "" : " [estimated]"
                let domainCategory = DomainIntelligence.classify(domain: site.domain)
                let siteType = domainCategory.siteGroup.map { " | site: \($0)" } ?? ""
                context += "\(i + 1). \(site.domain)\(title) — \(site.formattedDuration)\(siteType)\(confidence)\n"
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
        Highlight key patterns, the most-used categories, apps, and websites, and whether \
        the day was focused or fragmented. Keep it under 200 words. \
        Write plain flowing prose — short paragraphs only. \
        Do not use markdown headings, bold markers, bullet lists, or tables.

        \(activityContext)
        """
    }

    static func questionPrompt(question: String, activityContext: String) -> String {
        """
        The user is asking about their activity. Answer based on the data below. \
        If the data doesn't contain enough information to answer, say so. \
        When supported by the evidence, synthesize across categories before listing apps.

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
