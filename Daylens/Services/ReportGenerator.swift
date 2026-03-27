import Foundation

struct ReportGenerator {
    static func generateDailyReport(
        date: Date,
        appSummaries: [AppUsageSummary],
        workBlocks: [WorkContextBlock],
        focusSessions: [FocusSessionRecord],
        websiteSummaries: [WebsiteUsageSummary]
    ) -> String {
        let totalActiveTime = appSummaries.reduce(0.0) { $0 + $1.totalDuration }
        let totalSwitchCount = workBlocks.reduce(0) { $0 + $1.switchCount }
        let completedFocusSessions = focusSessions.filter { $0.status == .completed }
        let focusedTime = appSummaries
            .filter { $0.category.isFocused }
            .reduce(0.0) { $0 + $1.totalDuration }
        let browserTotal = appSummaries
            .filter { $0.category == .browsing }
            .reduce(0.0) { $0 + $1.totalDuration }
        let focusedWebsiteCredit = min(
            websiteSummaries
                .filter { DomainIntelligence.classify(domain: $0.domain).category.isFocused }
                .reduce(0.0) { $0 + $1.totalDuration },
            browserTotal
        )
        let totalSessionCount = max(appSummaries.reduce(0) { $0 + $1.sessionCount }, 1)
        let focusScore = FocusScoreCalculator.compute(
            focusedTime: focusedTime,
            totalTime: totalActiveTime,
            sessionCount: totalSessionCount,
            websiteFocusCredit: focusedWebsiteCredit
        )
        let focusPercent = Int((focusScore * 100).rounded())
        let focusLabel: String
        switch focusPercent {
        case 75...:
            focusLabel = "high"
        case 50...74:
            focusLabel = "medium"
        default:
            focusLabel = "low"
        }

        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "EEEE, MMMM d"

        var lines = [
            "## Daily Report - \(dateFormatter.string(from: date))",
            "",
            "### Overview",
            "- Total active time: \(formatDuration(totalActiveTime))",
            "- Focus quality: \(focusPercent)% (\(focusLabel) day)",
            "- App switches: \(totalSwitchCount)",
            "- Focus sessions completed: \(completedFocusSessions.count)",
            "",
            "### Time Blocks",
        ]

        if workBlocks.isEmpty {
            lines.append("- No meaningful time blocks detected.")
        } else {
            for block in workBlocks {
                lines.append(
                    "- **\(block.displayLabel)** - \(formatDuration(block.duration)) (\(block.dominantCategory.rawValue))"
                )
            }
        }

        lines.append("")
        lines.append("### Top Apps")
        if appSummaries.isEmpty {
            lines.append("- No app activity recorded.")
        } else {
            for app in appSummaries.prefix(5) {
                lines.append("- \(app.appName) - \(app.formattedDuration) (\(app.category.rawValue))")
            }
        }

        lines.append("")
        lines.append("### Biggest Time Sink")
        lines.append(biggestTimeSinkSentence(appSummaries: appSummaries, websiteSummaries: websiteSummaries))

        return lines.joined(separator: "\n")
    }

    static func generateWeeklyReport(
        weekStart: Date,
        dailySummaries: [DailySummary]
    ) -> String {
        let calendar = Calendar.current
        let normalizedWeekStart = calendar.startOfDay(for: weekStart)
        let weekEnd = calendar.date(byAdding: .day, value: 6, to: normalizedWeekStart) ?? normalizedWeekStart
        let nextWeekStart = calendar.date(byAdding: .day, value: 7, to: normalizedWeekStart) ?? normalizedWeekStart
        let previousWeekStart = calendar.date(byAdding: .day, value: -7, to: normalizedWeekStart) ?? normalizedWeekStart

        let currentWeek = dailySummaries
            .filter { $0.date >= normalizedWeekStart && $0.date < nextWeekStart }
            .sorted { $0.date < $1.date }
        let previousWeek = dailySummaries
            .filter { $0.date >= previousWeekStart && $0.date < normalizedWeekStart }
            .sorted { $0.date < $1.date }

        let bestDaySummary = currentWeek.max { lhs, rhs in
            if lhs.focusScore == rhs.focusScore {
                return lhs.totalActiveTime < rhs.totalActiveTime
            }
            return lhs.focusScore < rhs.focusScore
        }
        let estimatedFocusedTime = currentWeek.reduce(0.0) { $0 + ($1.totalActiveTime * $1.focusScore) }
        let averageActiveTime = currentWeek.isEmpty ? 0 : currentWeek.reduce(0.0) { $0 + $1.totalActiveTime } / Double(currentWeek.count)

        let headerFormatter = DateFormatter()
        headerFormatter.dateFormat = "MMMM d"
        let bestDayFormatter = DateFormatter()
        bestDayFormatter.dateFormat = "EEEE"

        let lines = [
            "## Week in Review - \(headerFormatter.string(from: normalizedWeekStart)) to \(headerFormatter.string(from: weekEnd))",
            "",
            "### Highlights",
            "- Best day: \(bestDayDescription(bestDaySummary, formatter: bestDayFormatter))",
            "- Total focused time: \(formatDuration(estimatedFocusedTime))",
            "- Daily average: \(formatDuration(averageActiveTime))",
            "",
            "### Trend",
            trendSentence(currentWeek: currentWeek, previousWeek: previousWeek),
        ]

        return lines.joined(separator: "\n")
    }

    private static func biggestTimeSinkSentence(
        appSummaries: [AppUsageSummary],
        websiteSummaries: [WebsiteUsageSummary]
    ) -> String {
        let topNonFocusApp = appSummaries
            .filter { !$0.category.isFocused }
            .max { lhs, rhs in lhs.totalDuration < rhs.totalDuration }
        let topNonFocusSite = websiteSummaries
            .filter { !DomainIntelligence.classify(domain: $0.domain).category.isFocused }
            .max { lhs, rhs in lhs.totalDuration < rhs.totalDuration }

        switch (topNonFocusApp, topNonFocusSite) {
        case let (app?, site?) where site.totalDuration > app.totalDuration:
            return "\(site.domain) was the biggest non-focus time sink at \(site.formattedDuration)."
        case let (app?, _):
            return "\(app.appName) was the biggest non-focus time sink at \(app.formattedDuration)."
        case let (_, site?):
            return "\(site.domain) was the biggest non-focus time sink at \(site.formattedDuration)."
        default:
            return "No obvious non-focus time sink stood out."
        }
    }

    private static func bestDayDescription(_ summary: DailySummary?, formatter: DateFormatter) -> String {
        guard let summary else { return "No tracked days this week" }
        return "\(formatter.string(from: summary.date)) (\(summary.focusScorePercent)% focus)"
    }

    private static func trendSentence(currentWeek: [DailySummary], previousWeek: [DailySummary]) -> String {
        guard !currentWeek.isEmpty else {
            return "There is not enough activity data this week to identify a trend."
        }

        guard !previousWeek.isEmpty else {
            return "No prior-week data was available for comparison."
        }

        let currentActive = currentWeek.reduce(0.0) { $0 + $1.totalActiveTime }
        let previousActive = previousWeek.reduce(0.0) { $0 + $1.totalActiveTime }
        let currentFocus = currentWeek.reduce(0.0) { $0 + $1.focusScore } / Double(currentWeek.count)
        let previousFocus = previousWeek.reduce(0.0) { $0 + $1.focusScore } / Double(previousWeek.count)

        let activeDirection = currentActive >= previousActive ? "up" : "down"
        let focusDirection = currentFocus >= previousFocus ? "higher" : "lower"
        return "Active time was \(activeDirection) versus last week, and average focus quality was \(focusDirection) (\(Int((currentFocus * 100).rounded()))% vs \(Int((previousFocus * 100).rounded()))%)."
    }

    private static func formatDuration(_ seconds: TimeInterval) -> String {
        guard seconds > 0 else { return "0m" }

        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        if minutes > 0 {
            return "\(minutes)m"
        }
        return "\(Int(seconds))s"
    }
}
