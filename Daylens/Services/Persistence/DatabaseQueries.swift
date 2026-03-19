import Foundation
import GRDB

/// Reusable database query methods.
extension AppDatabase {

    // MARK: - Insert

    func insertEvent(_ event: ActivityEvent) throws {
        try dbQueue.write { db in
            var event = event
            try event.insert(db)
        }
    }

    func insertAppSession(_ session: AppSession) throws {
        try dbQueue.write { db in
            var session = session
            try session.insert(db)
        }
    }

    func insertBrowserSession(_ session: BrowserSession) throws {
        try dbQueue.write { db in
            var session = session
            try session.insert(db)
        }
    }

    func insertWebsiteVisit(_ visit: WebsiteVisit) throws {
        try dbQueue.write { db in
            var visit = visit
            try visit.insert(db)
        }
    }

    func saveDailySummary(_ summary: DailySummary) throws {
        try dbQueue.write { db in
            var summary = summary
            try summary.save(db, onConflict: .replace)
        }
    }

    // MARK: - App Sessions

    func appUsageSummaries(for date: Date) throws -> [AppUsageSummary] {
        try dbQueue.read { db in
            let dayStart = Calendar.current.startOfDay(for: date)
            let dayEnd = Calendar.current.date(byAdding: .day, value: 1, to: dayStart)!

            let rows = try Row.fetchAll(db, sql: """
                SELECT bundleID, appName, category, isBrowser,
                       SUM(duration) as totalDuration,
                       COUNT(*) as sessionCount
                FROM app_sessions
                WHERE startTime >= ? AND startTime < ?
                GROUP BY bundleID
                ORDER BY totalDuration DESC
                """, arguments: [dayStart, dayEnd])

            return rows.map { row in
                AppUsageSummary(
                    bundleID: row["bundleID"],
                    appName: row["appName"],
                    totalDuration: row["totalDuration"],
                    sessionCount: row["sessionCount"],
                    category: AppCategory(rawValue: row["category"]) ?? .other,
                    isBrowser: row["isBrowser"]
                )
            }
        }
    }

    // MARK: - Browser Sessions

    func browserUsageSummaries(for date: Date) throws -> [BrowserUsageSummary] {
        try dbQueue.read { db in
            let dayStart = Calendar.current.startOfDay(for: date)
            let dayEnd = Calendar.current.date(byAdding: .day, value: 1, to: dayStart)!

            let rows = try Row.fetchAll(db, sql: """
                SELECT browserBundleID, browserName,
                       SUM(duration) as totalDuration,
                       COUNT(*) as sessionCount
                FROM browser_sessions
                WHERE startTime >= ? AND startTime < ?
                GROUP BY browserBundleID
                ORDER BY totalDuration DESC
                """, arguments: [dayStart, dayEnd])

            return rows.map { row in
                let bundleID: String = row["browserBundleID"]
                let topDomains = (try? self.topDomains(for: date, browserBundleID: bundleID, limit: 3, in: db)) ?? []
                return BrowserUsageSummary(
                    browserBundleID: bundleID,
                    browserName: row["browserName"],
                    totalDuration: row["totalDuration"],
                    sessionCount: row["sessionCount"],
                    topDomains: topDomains
                )
            }
        }
    }

    private func topDomains(for date: Date, browserBundleID: String, limit: Int, in db: Database) throws -> [String] {
        let dayStart = Calendar.current.startOfDay(for: date)
        let dayEnd = Calendar.current.date(byAdding: .day, value: 1, to: dayStart)!

        let rows = try Row.fetchAll(db, sql: """
            SELECT domain, SUM(duration) as totalDuration
            FROM website_visits
            WHERE startTime >= ? AND startTime < ? AND browserBundleID = ?
            GROUP BY domain
            ORDER BY totalDuration DESC
            LIMIT ?
            """, arguments: [dayStart, dayEnd, browserBundleID, limit])

        return rows.map { $0["domain"] as String }
    }

    // MARK: - Website Visits

    func websiteUsageSummaries(for date: Date) throws -> [WebsiteUsageSummary] {
        try dbQueue.read { db in
            let dayStart = Calendar.current.startOfDay(for: date)
            let dayEnd = Calendar.current.date(byAdding: .day, value: 1, to: dayStart)!

            let rows = try Row.fetchAll(db, sql: """
                SELECT domain, browserBundleID, confidence,
                       SUM(duration) as totalDuration,
                       COUNT(*) as visitCount,
                       pageTitle
                FROM website_visits
                WHERE startTime >= ? AND startTime < ?
                GROUP BY domain
                ORDER BY totalDuration DESC
                """, arguments: [dayStart, dayEnd])

            return rows.map { row in
                let bundleID: String = row["browserBundleID"]
                return WebsiteUsageSummary(
                    domain: row["domain"],
                    totalDuration: row["totalDuration"],
                    visitCount: row["visitCount"],
                    topPageTitle: row["pageTitle"],
                    confidence: ActivityEvent.ConfidenceLevel(rawValue: row["confidence"]) ?? .low,
                    browserName: Constants.browserNames[bundleID] ?? "Browser"
                )
            }
        }
    }

    // MARK: - Website Visits by Browser

    func websiteVisitsForBrowser(date: Date, browserBundleID: String, limit: Int = 20) throws -> [WebsiteUsageSummary] {
        try dbQueue.read { db in
            let dayStart = Calendar.current.startOfDay(for: date)
            let dayEnd = Calendar.current.date(byAdding: .day, value: 1, to: dayStart)!

            let rows = try Row.fetchAll(db, sql: """
                SELECT domain, browserBundleID, confidence,
                       SUM(duration) as totalDuration,
                       COUNT(*) as visitCount,
                       pageTitle
                FROM website_visits
                WHERE startTime >= ? AND startTime < ? AND browserBundleID = ?
                GROUP BY domain
                ORDER BY totalDuration DESC
                LIMIT ?
                """, arguments: [dayStart, dayEnd, browserBundleID, limit])

            return rows.map { row in
                let bundleID: String = row["browserBundleID"]
                return WebsiteUsageSummary(
                    domain: row["domain"],
                    totalDuration: row["totalDuration"],
                    visitCount: row["visitCount"],
                    topPageTitle: row["pageTitle"],
                    confidence: ActivityEvent.ConfidenceLevel(rawValue: row["confidence"]) ?? .low,
                    browserName: Constants.browserNames[bundleID] ?? "Browser"
                )
            }
        }
    }

    // MARK: - Daily Summary

    func dailySummary(for date: Date) throws -> DailySummary? {
        try dbQueue.read { db in
            let dayStart = Calendar.current.startOfDay(for: date)
            return try DailySummary.filter(Column("date") == dayStart).fetchOne(db)
        }
    }

    func recentDailySummaries(limit: Int = 7) throws -> [DailySummary] {
        try dbQueue.read { db in
            try DailySummary
                .order(Column("date").desc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    // MARK: - Timeline

    func timelineEvents(for date: Date) throws -> [AppSession] {
        try dbQueue.read { db in
            let dayStart = Calendar.current.startOfDay(for: date)
            let dayEnd = Calendar.current.date(byAdding: .day, value: 1, to: dayStart)!
            return try AppSession
                .filter(Column("startTime") >= dayStart && Column("startTime") < dayEnd)
                .order(Column("startTime").asc)
                .fetchAll(db)
        }
    }

    // MARK: - Cleanup

    func deleteDataOlderThan(days: Int) throws {
        try dbQueue.write { db in
            let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: Date())!
            try db.execute(sql: "DELETE FROM activity_events WHERE timestamp < ?", arguments: [cutoff])
            try db.execute(sql: "DELETE FROM app_sessions WHERE startTime < ?", arguments: [cutoff])
            try db.execute(sql: "DELETE FROM browser_sessions WHERE startTime < ?", arguments: [cutoff])
            try db.execute(sql: "DELETE FROM website_visits WHERE startTime < ?", arguments: [cutoff])
            try db.execute(sql: "DELETE FROM daily_summaries WHERE date < ?", arguments: [cutoff])
        }
    }

    func deleteAllData() throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM activity_events")
            try db.execute(sql: "DELETE FROM app_sessions")
            try db.execute(sql: "DELETE FROM browser_sessions")
            try db.execute(sql: "DELETE FROM website_visits")
            try db.execute(sql: "DELETE FROM daily_summaries")
            try db.execute(sql: "DELETE FROM ai_conversations")
        }
    }

    // MARK: - Export

    /// Export all data for a date range as a JSON-compatible dictionary.
    func exportData(from startDate: Date, to endDate: Date) throws -> [String: Any] {
        try dbQueue.read { db in
            let appSessions = try Row.fetchAll(db, sql: """
                SELECT * FROM app_sessions WHERE startTime >= ? AND startTime < ?
                ORDER BY startTime ASC
                """, arguments: [startDate, endDate])

            let websiteVisits = try Row.fetchAll(db, sql: """
                SELECT * FROM website_visits WHERE startTime >= ? AND startTime < ?
                ORDER BY startTime ASC
                """, arguments: [startDate, endDate])

            let dailySummaries = try Row.fetchAll(db, sql: """
                SELECT * FROM daily_summaries WHERE date >= ? AND date < ?
                ORDER BY date ASC
                """, arguments: [startDate, endDate])

            let browserSessions = try Row.fetchAll(db, sql: """
                SELECT * FROM browser_sessions WHERE startTime >= ? AND startTime < ?
                ORDER BY startTime ASC
                """, arguments: [startDate, endDate])

            let formatter = ISO8601DateFormatter()

            func rowToDict(_ row: Row) -> [String: Any] {
                var dict: [String: Any] = [:]
                for column in row.columnNames {
                    if let value = row[column] as? Date {
                        dict[column] = formatter.string(from: value)
                    } else if let value = row[column] as? String {
                        dict[column] = value
                    } else if let value = row[column] as? Int64 {
                        dict[column] = value
                    } else if let value = row[column] as? Double {
                        dict[column] = value
                    } else if let value = row[column] as? Bool {
                        dict[column] = value
                    }
                }
                return dict
            }

            return [
                "exportedAt": formatter.string(from: Date()),
                "dateRange": [
                    "from": formatter.string(from: startDate),
                    "to": formatter.string(from: endDate),
                ],
                "appSessions": appSessions.map(rowToDict),
                "browserSessions": browserSessions.map(rowToDict),
                "websiteVisits": websiteVisits.map(rowToDict),
                "dailySummaries": dailySummaries.map(rowToDict),
            ]
        }
    }
}
