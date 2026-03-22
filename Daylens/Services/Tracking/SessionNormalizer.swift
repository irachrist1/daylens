import Foundation
import GRDB

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

    func recomputeAllDailySummaries() throws {
        let dates = try database.dbQueue.read { db in
            try Row.fetchAll(db, sql: """
                SELECT DISTINCT date
                FROM app_sessions
                ORDER BY date ASC
                """).compactMap { $0["date"] as Date? }
        }

        for date in dates {
            _ = try computeDailySummary(for: date)
        }
    }

    /// Focus score: ratio of time in focus categories vs total time,
    /// penalized by context switching frequency.
    private func computeFocusScore(sessions: [AppSession], totalTime: TimeInterval) -> Double {
        let focusedTime = sessions
            .filter { $0.category.isFocused }
            .reduce(0.0) { $0 + $1.duration }
        return FocusScoreCalculator.compute(
            focusedTime: focusedTime,
            totalTime: totalTime,
            sessionCount: sessions.count
        )
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
