import Foundation
import GRDB

/// Computes dashboard-ready aggregations from raw session tables.
/// All queries are date-scoped and optimized for the indexed dateKey column.
final class DailyAggregator {
    private let db: AppDatabase

    init(db: AppDatabase = .shared) {
        self.db = db
    }

    // MARK: - Total active time

    func totalActiveSeconds(for dateKey: String) throws -> Double {
        try db.read { database in
            let row = try Row.fetchOne(
                database,
                sql: "SELECT COALESCE(SUM(activeDuration), 0) AS total FROM app_sessions WHERE dateKey = ?",
                arguments: [dateKey]
            )
            return row?["total"] ?? 0
        }
    }

    // MARK: - Top apps

    func topApps(for dateKey: String, limit: Int = 10) throws -> [AppUsageSummary] {
        try db.read { database in
            let rows = try Row.fetchAll(
                database,
                sql: """
                SELECT appBundleId, appName, appIconPath,
                       SUM(activeDuration) AS totalSeconds,
                       COUNT(*) AS sessionCount
                FROM app_sessions
                WHERE dateKey = ?
                  AND activeDuration >= 5
                GROUP BY appBundleId
                ORDER BY totalSeconds DESC
                LIMIT ?
                """,
                arguments: [dateKey, limit]
            )
            return rows.map {
                AppUsageSummary(
                    id: $0["appBundleId"],
                    appName: $0["appName"],
                    appBundleId: $0["appBundleId"],
                    appIconPath: $0["appIconPath"],
                    totalSeconds: $0["totalSeconds"],
                    sessionCount: $0["sessionCount"],
                    dateKey: dateKey
                )
            }
        }
    }

    // MARK: - Top browsers

    func topBrowsers(for dateKey: String, limit: Int = 5) throws -> [BrowserUsageSummary] {
        try db.read { database in
            let rows = try Row.fetchAll(
                database,
                sql: """
                SELECT browserBundleId, browserName,
                       SUM(activeDuration) AS totalSeconds,
                       COUNT(*) AS sessionCount
                FROM browser_sessions
                WHERE dateKey = ?
                GROUP BY browserBundleId
                ORDER BY totalSeconds DESC
                LIMIT ?
                """,
                arguments: [dateKey, limit]
            )
            return rows.map {
                BrowserUsageSummary(
                    id: $0["browserBundleId"],
                    browserName: $0["browserName"],
                    browserBundleId: $0["browserBundleId"],
                    totalSeconds: $0["totalSeconds"],
                    sessionCount: $0["sessionCount"],
                    dateKey: dateKey
                )
            }
        }
    }

    // MARK: - Top websites

    func topWebsites(for dateKey: String, limit: Int = 20) throws -> [WebsiteUsageSummary] {
        try db.read { database in
            let rows = try Row.fetchAll(
                database,
                sql: """
                SELECT domain,
                       SUM(duration) AS totalSeconds,
                       COUNT(*) AS visitCount,
                       AVG(confidence) AS avgConfidence
                FROM website_visits
                WHERE dateKey = ? AND isPrivate = 0
                GROUP BY domain
                HAVING totalSeconds >= 5
                ORDER BY totalSeconds DESC
                LIMIT ?
                """,
                arguments: [dateKey, limit]
            )
            return rows.map {
                WebsiteUsageSummary(
                    id: $0["domain"],
                    domain: $0["domain"],
                    totalSeconds: $0["totalSeconds"],
                    visitCount: $0["visitCount"],
                    avgConfidence: $0["avgConfidence"],
                    dateKey: dateKey
                )
            }
        }
    }

    // MARK: - Focus score

    /// Focus score: ratio of time in top app vs total active time, penalized by switch frequency.
    /// Returns 0.0 – 1.0
    func focusScore(for dateKey: String) throws -> Double {
        let total = try totalActiveSeconds(for: dateKey)
        guard total > 0 else { return 0 }

        let switchCount = try contextSwitchCount(for: dateKey)
        let topApps = try topApps(for: dateKey, limit: 1)
        let topAppTime = topApps.first?.totalSeconds ?? 0

        // Base: fraction of time in top app
        let concentrationRatio = topAppTime / total

        // Penalty: more than 30 switches/hour reduces score
        let switchRate = Double(switchCount) / (total / 3600)
        let switchPenalty = min(1.0, switchRate / 30.0) * 0.3

        return max(0, min(1, concentrationRatio - switchPenalty))
    }

    /// Number of app context switches in a day (proxy for fragmentation)
    func contextSwitchCount(for dateKey: String) throws -> Int {
        try db.read { database in
            let row = try Row.fetchOne(
                database,
                sql: "SELECT COUNT(*) AS cnt FROM app_sessions WHERE dateKey = ?",
                arguments: [dateKey]
            )
            return row?["cnt"] ?? 0
        }
    }

    // MARK: - Timeline segments

    /// Returns all app sessions for a date, ordered by start time, suitable for timeline rendering.
    func timelineSegments(for dateKey: String) throws -> [AppSession] {
        try db.read { database in
            try AppSession
                .filter(Column("dateKey") == dateKey)
                .order(Column("startedAt"))
                .fetchAll(database)
        }
    }

    // MARK: - Multi-day trends

    struct DayTrend: Identifiable {
        var id: String { dateKey }
        let dateKey: String
        let totalActiveSeconds: Double
        let focusScore: Double
    }

    func recentTrends(days: Int = 7) throws -> [DayTrend] {
        let calendar = Calendar.current
        let today = Date()
        var results: [DayTrend] = []

        for offset in 0..<days {
            guard let date = calendar.date(byAdding: .day, value: -offset, to: today) else { continue }
            let key = AppSession.makeDateKey(from: date.timeIntervalSince1970)
            let total = try totalActiveSeconds(for: key)
            let focus = try focusScore(for: key)
            results.append(DayTrend(dateKey: key, totalActiveSeconds: total, focusScore: focus))
        }

        return results.reversed()
    }

    // MARK: - Structured snapshot for AI

    /// Returns a JSON-serializable dictionary of today's data for AI prompt injection.
    func buildAIDataSnapshot(for dateKey: String) throws -> [String: Any] {
        let total = try totalActiveSeconds(for: dateKey)
        let apps = try topApps(for: dateKey)
        let sites = try topWebsites(for: dateKey)
        let browsers = try topBrowsers(for: dateKey)
        let switchCount = try contextSwitchCount(for: dateKey)
        let focus = try focusScore(for: dateKey)

        return [
            "dateKey": dateKey,
            "totalActiveSeconds": total,
            "focusScore": String(format: "%.2f", focus),
            "contextSwitchCount": switchCount,
            "topApps": apps.map { ["name": $0.appName, "seconds": $0.totalSeconds] },
            "topSites": sites.map { ["domain": $0.domain, "seconds": $0.totalSeconds] },
            "topBrowsers": browsers.map { ["name": $0.browserName, "seconds": $0.totalSeconds] }
        ]
    }
}
