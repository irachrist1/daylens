import Foundation

/// Normalizes raw sessions by merging short gaps and computing daily summaries.
final class SessionNormalizer {
    private let database: AppDatabase

    init(database: AppDatabase) {
        self.database = database
    }

    /// Compute and save a daily summary for the given date.
    func computeDailySummary(for date: Date) throws -> DailySummary {
        let appSummaries = try database.appUsageSummaries(for: date)
        let websiteSummaries = try database.websiteUsageSummaries(for: date)
        let browserSummaries = try database.browserUsageSummaries(for: date)
        let timeline = try database.timelineEvents(for: date)

        let totalActiveTime = appSummaries.reduce(0) { $0 + $1.totalDuration }
        let contextSwitches = max(0, timeline.count - 1)
        let focusScore = computeFocusScore(sessions: timeline, totalTime: totalActiveTime)
        let longestStreak = computeLongestFocusStreak(sessions: timeline)

        let topApp = appSummaries.first
        let topDomain = websiteSummaries.first?.domain

        let summary = DailySummary(
            date: Calendar.current.startOfDay(for: date),
            totalActiveTime: totalActiveTime,
            totalIdleTime: 0, // Computed separately by idle detector
            appCount: appSummaries.count,
            browserCount: browserSummaries.count,
            domainCount: websiteSummaries.count,
            sessionCount: timeline.count,
            contextSwitches: contextSwitches,
            focusScore: focusScore,
            longestFocusStreak: longestStreak,
            topAppBundleID: topApp?.bundleID,
            topDomain: topDomain,
            aiSummary: nil,
            aiSummaryGeneratedAt: nil
        )

        try database.saveDailySummary(summary)
        return summary
    }

    /// Focus score: ratio of time in focus categories vs total time,
    /// penalized by context switching frequency.
    private func computeFocusScore(sessions: [AppSession], totalTime: TimeInterval) -> Double {
        guard totalTime > 0 else { return 0 }

        let focusedTime = sessions
            .filter { $0.category.isFocused }
            .reduce(0.0) { $0 + $1.duration }

        let focusRatio = focusedTime / totalTime

        // Penalize high context switching
        let switchRate = Double(sessions.count) / max(totalTime / 3600.0, 0.1) // switches per hour
        let switchPenalty = min(switchRate / 60.0, 0.3) // Max 30% penalty at 60 switches/hour

        return max(0, min(1.0, focusRatio - switchPenalty))
    }

    /// Longest continuous streak of focused app usage.
    private func computeLongestFocusStreak(sessions: [AppSession]) -> TimeInterval {
        var longestStreak: TimeInterval = 0
        var currentStreak: TimeInterval = 0
        var lastEndTime: Date?

        for session in sessions where session.category.isFocused {
            if let lastEnd = lastEndTime,
               session.startTime.timeIntervalSince(lastEnd) <= Constants.sessionMergeThreshold {
                currentStreak += session.duration
            } else {
                currentStreak = session.duration
            }
            lastEndTime = session.endTime
            longestStreak = max(longestStreak, currentStreak)
        }

        return longestStreak
    }
}
