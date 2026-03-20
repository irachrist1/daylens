import Foundation

struct AIDayContextPayload {
    let date: Date
    let appSummaries: [AppUsageSummary]
    let websiteSummaries: [WebsiteUsageSummary]
    let browserSummaries: [BrowserUsageSummary]
    let dailySummary: DailySummary?
}

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
    - Prefer supported category-level patterns (Development, AI Tools, Writing, Productivity) over repeating raw app names
    - Treat semantic labels as deterministic app-purpose hints, not proof of the exact task the user performed
    - Never turn estimated browser timing into exact unsupported claims
    - When website timing is estimated, use wording like "about", "roughly", or "estimated"
    - You may compare across days only when those comparison days are explicitly present in the context
    - Browser time on focused domains (AI tools, development sites, research, writing tools) counts as productive focused work — treat it accordingly
    - Apps or sites marked "user override" have been explicitly categorized by the user and should be treated as authoritative
    - When the user asks what information would help you, tell them: app category overrides for uncategorized apps, their goals for the day, and what specific apps like terminals or custom tools mean in their workflow

    """

    /// Build context string from tracked data for a specific day.
    static func buildDayContext(
        date: Date,
        appSummaries: [AppUsageSummary],
        websiteSummaries: [WebsiteUsageSummary],
        browserSummaries: [BrowserUsageSummary],
        dailySummary: DailySummary?,
        previousDays: [AIDayContextPayload] = []
    ) -> String {
        let primaryDay = AIDayContextPayload(
            date: date,
            appSummaries: appSummaries,
            websiteSummaries: websiteSummaries,
            browserSummaries: browserSummaries,
            dailySummary: dailySummary
        )
        return buildContext(primaryDay: primaryDay, previousDays: previousDays)
    }

    static func buildContext(
        primaryDay: AIDayContextPayload,
        previousDays: [AIDayContextPayload] = []
    ) -> String {
        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .full

        var context = "## Activity Data for \(dateFormatter.string(from: primaryDay.date))\n\n"
        let categorySummaries = SemanticUsageRollups.categorySummaries(from: primaryDay.appSummaries)

        context += "### Data Notes\n"
        context += "- Main summaries exclude known system/session noise such as loginwindow, lock/unlock artifacts, and near-zero session-management churn.\n"
        context += "- Website durations marked [estimated] are grounded in browser evidence but may be approximate when active-tab timing is incomplete.\n\n"

        // Daily overview
        if let summary = primaryDay.dailySummary {
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
        if !primaryDay.appSummaries.isEmpty {
            context += "### Top Apps\n"
            for (i, app) in primaryDay.appSummaries.prefix(10).enumerated() {
                let semantic = app.semanticLabel.map { " | type: \($0)" } ?? ""
                let confidence = app.classificationConfidence == .high ? "" : " | category confidence: \(app.classificationConfidence.rawValue.lowercased())"
                let overrideNote = app.classification.rule == "user-override" ? " [user override]" : ""
                context += "\(i + 1). \(app.appName) — \(app.formattedDuration) | category: \(app.category.rawValue)\(overrideNote)\(semantic) | sessions: \(app.sessionCount)\(confidence)\n"
            }
            context += "\n"
        }

        // Website focus attribution note
        let focusedWebSites = primaryDay.websiteSummaries.filter {
            DomainIntelligence.classify(domain: $0.domain).category.isFocused
        }
        if !focusedWebSites.isEmpty {
            let focusedWebTime = focusedWebSites.reduce(0.0) { $0 + $1.totalDuration }
            context += "### Focused Browser Time\n"
            context += "- Productive websites (research, AI tools, development, writing): \(formatDuration(focusedWebTime))\n"
            context += "- Top focused sites: \(focusedWebSites.prefix(5).map(\.domain).joined(separator: ", "))\n\n"
        }

        // Top websites with domain intelligence grouping
        if !primaryDay.websiteSummaries.isEmpty {
            let grouped = DomainIntelligence.groupedSummaries(from: primaryDay.websiteSummaries)
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
            for (i, site) in primaryDay.websiteSummaries.prefix(10).enumerated() {
                let title = site.topPageTitle.map { " (\($0))" } ?? ""
                let confidence = site.confidence == .high ? "" : " [estimated]"
                let domainCategory = DomainIntelligence.classify(domain: site.domain)
                let siteType = domainCategory.siteGroup.map { " | site: \($0)" } ?? ""
                context += "\(i + 1). \(site.domain)\(title) — \(site.formattedDuration)\(siteType)\(confidence)\n"
            }
            context += "\n"
        }

        // Browsers
        if !primaryDay.browserSummaries.isEmpty {
            context += "### Browsers Used\n"
            for browser in primaryDay.browserSummaries {
                let domains = browser.topDomains.isEmpty ? "" : " (top sites: \(browser.topDomains.joined(separator: ", ")))"
                context += "- \(browser.browserName): \(browser.formattedDuration)\(domains)\n"
            }
            context += "\n"
        }

        if !previousDays.isEmpty {
            context += "### Recent Day Comparisons\n"
            for day in previousDays.prefix(5) {
                let dateText = dateFormatter.string(from: day.date)
                let activeTime = day.dailySummary?.formattedActiveTime ?? formatDuration(day.appSummaries.reduce(0) { $0 + $1.totalDuration })
                let topCategory = SemanticUsageRollups.categorySummaries(from: day.appSummaries).first?.category.rawValue ?? "No clear category"
                let topApp = day.appSummaries.first?.appName ?? "No dominant app"
                let topSite = day.websiteSummaries.first?.domain ?? "No notable site"
                context += "- \(dateText): \(activeTime) active | top category: \(topCategory) | top app: \(topApp) | top site: \(topSite)\n"
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
