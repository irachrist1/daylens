import Foundation

/// Constructs grounded prompts for the AI analyst from real activity data.
/// Never sends raw URLs or sensitive data. Only aggregated, redacted summaries.
struct PromptBuilder {
    /// System prompt that establishes the AI analyst's role and constraints.
    static let systemPrompt = """
    You are an activity analyst for a macOS productivity tool called Activity Analyst. \
    Your role is to help users understand their computer usage patterns.

    CONSTRAINTS:
    - Only make claims supported by the activity data provided to you.
    - If the data is insufficient to answer a question, say so honestly.
    - Never fabricate statistics, durations, or app names.
    - Be concise and actionable. Avoid generic productivity platitudes.
    - When citing durations, use the exact numbers from the data.
    - Present insights as observations, not judgments.
    - Use a calm, professional tone. No exclamation marks or over-enthusiasm.
    - If asked about something not in the data, explain what data is available instead.

    FORMAT:
    - Use short paragraphs.
    - Lead with the most important observation.
    - Cite specific apps, websites, and durations when relevant.
    - End with one actionable observation when appropriate.
    """

    /// Builds a prompt for generating a daily summary.
    static func dailySummaryPrompt(
        date: Date,
        summary: DailySummary,
        topApps: [RankedItem],
        topWebsites: [RankedItem],
        sessionCount: Int,
        switchCount: Int
    ) -> String {
        let dateStr = DateFormatters.mediumDate.string(from: date)
        let activeTime = DurationFormatter.formatLong(summary.totalActiveTime)
        let focusPercent = Int(summary.focusScore * 100)
        let fragPercent = Int(summary.fragmentationScore * 100)

        var prompt = """
        Generate a daily summary for \(dateStr).

        ACTIVITY DATA:
        - Total active time: \(activeTime)
        - Sessions: \(sessionCount)
        - App switches: \(switchCount)
        - Focus score: \(focusPercent)% (higher = more focused)
        - Fragmentation score: \(fragPercent)% (higher = more fragmented)

        TOP APPS:
        """

        for app in topApps.prefix(10) {
            let duration = DurationFormatter.format(app.duration)
            let percent = Int(app.percentage * 100)
            prompt += "\n- \(app.name): \(duration) (\(percent)%) — \(app.category.displayName)"
        }

        if !topWebsites.isEmpty {
            prompt += "\n\nTOP WEBSITES:"
            for site in topWebsites.prefix(10) {
                let duration = DurationFormatter.format(site.duration)
                let percent = Int(site.percentage * 100)
                prompt += "\n- \(site.name): \(duration) (\(percent)%) — \(site.category.displayName)"
            }
        }

        prompt += """

        \nSummarize this day in 3-5 sentences. Focus on:
        1. How the user spent their time (key apps and websites)
        2. Whether the day was focused or fragmented
        3. One specific pattern or observation worth noting
        """

        return prompt
    }

    /// Builds a prompt for answering a user question about their activity.
    static func questionPrompt(
        question: String,
        contextData: ActivityContext
    ) -> String {
        var prompt = """
        The user asks: "\(question)"

        AVAILABLE DATA (covering \(contextData.dateRange)):
        - Total active time: \(DurationFormatter.formatLong(contextData.totalActiveTime))
        """

        if !contextData.appDurations.isEmpty {
            prompt += "\n\nAPP USAGE:"
            for (name, duration) in contextData.appDurations.prefix(15) {
                prompt += "\n- \(name): \(DurationFormatter.format(duration))"
            }
        }

        if !contextData.websiteDurations.isEmpty {
            prompt += "\n\nWEBSITE USAGE:"
            for (domain, duration) in contextData.websiteDurations.prefix(15) {
                prompt += "\n- \(domain): \(DurationFormatter.format(duration))"
            }
        }

        if !contextData.browserDurations.isEmpty {
            prompt += "\n\nBROWSER USAGE:"
            for (name, duration) in contextData.browserDurations.prefix(5) {
                prompt += "\n- \(name): \(DurationFormatter.format(duration))"
            }
        }

        prompt += """

        \nAnswer the user's question based ONLY on the data above. \
        If the data doesn't contain enough information to fully answer, explain what you can see \
        and what data is missing. Cite specific numbers from the data.
        """

        return prompt
    }

    /// Builds a prompt for identifying patterns and trends across multiple days.
    static func trendPrompt(summaries: [DailySummary]) -> String {
        var prompt = "Analyze the following multi-day activity data for patterns:\n\n"

        for summary in summaries.prefix(7) {
            let dateStr = DateFormatters.monthDay.string(from: summary.date)
            let active = DurationFormatter.format(summary.totalActiveTime)
            let focus = Int(summary.focusScore * 100)
            let sessions = summary.sessionCount

            prompt += "\(dateStr): \(active) active, \(focus)% focus, \(sessions) sessions"
            if !summary.topApps.isEmpty {
                let topApp = summary.topApps[0]
                prompt += ", top app: \(topApp.name) (\(DurationFormatter.format(topApp.duration)))"
            }
            prompt += "\n"
        }

        prompt += """

        Identify 2-3 notable patterns or trends across these days. \
        Be specific and cite actual numbers. Focus on changes in focus, \
        app usage shifts, or notable consistency/inconsistency.
        """

        return prompt
    }
}

/// Aggregated activity context for AI queries. Contains no raw URLs or sensitive data.
struct ActivityContext {
    let dateRange: String
    let totalActiveTime: TimeInterval
    let appDurations: [(name: String, duration: TimeInterval)]
    let websiteDurations: [(domain: String, duration: TimeInterval)]
    let browserDurations: [(name: String, duration: TimeInterval)]
    let focusScore: Double
    let sessionCount: Int
    let switchCount: Int
}
