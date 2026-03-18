import Foundation
import GRDB

/// Low-level persistence for raw activity events and sessions.
final class ActivityRepository {
    private let db: AppDatabase

    init(db: AppDatabase = .shared) {
        self.db = db
    }

    // MARK: - ActivityEvent

    func insertEvent(_ event: ActivityEvent) throws {
        try db.write { database in
            try event.insert(database)
        }
    }

    func recentEvents(limit: Int = 200) throws -> [ActivityEvent] {
        try db.read { database in
            try ActivityEvent
                .order(Column("timestamp").desc)
                .limit(limit)
                .fetchAll(database)
        }
    }

    // MARK: - AppSession

    func insertOrUpdateAppSession(_ session: AppSession) throws {
        try db.write { database in
            try session.save(database)
        }
    }

    func openAppSession(for bundleId: String) throws -> AppSession? {
        try db.read { database in
            try AppSession
                .filter(Column("appBundleId") == bundleId && Column("endedAt") == nil)
                .order(Column("startedAt").desc)
                .fetchOne(database)
        }
    }

    func closeAllOpenSessions(at timestamp: Double = Date().timeIntervalSince1970) throws {
        try db.write { database in
            try database.execute(
                sql: """
                UPDATE app_sessions
                SET endedAt = ?,
                    activeDuration = activeDuration + (? - startedAt)
                WHERE endedAt IS NULL
                """,
                arguments: [timestamp, timestamp]
            )
            try database.execute(
                sql: """
                UPDATE browser_sessions
                SET endedAt = ?,
                    activeDuration = activeDuration + (? - startedAt)
                WHERE endedAt IS NULL
                """,
                arguments: [timestamp, timestamp]
            )
            try database.execute(
                sql: """
                UPDATE website_visits
                SET endedAt = ?,
                    duration = duration + (? - startedAt)
                WHERE endedAt IS NULL
                """,
                arguments: [timestamp, timestamp]
            )
        }
    }

    // MARK: - BrowserSession

    func insertOrUpdateBrowserSession(_ session: BrowserSession) throws {
        try db.write { database in
            try session.save(database)
        }
    }

    func openBrowserSession(for bundleId: String) throws -> BrowserSession? {
        try db.read { database in
            try BrowserSession
                .filter(Column("browserBundleId") == bundleId && Column("endedAt") == nil)
                .order(Column("startedAt").desc)
                .fetchOne(database)
        }
    }

    // MARK: - WebsiteVisit

    func insertOrUpdateWebsiteVisit(_ visit: WebsiteVisit) throws {
        try db.write { database in
            try visit.save(database)
        }
    }

    func openWebsiteVisit(for domain: String, browser: String) throws -> WebsiteVisit? {
        try db.read { database in
            try WebsiteVisit
                .filter(Column("domain") == domain
                    && Column("browserName") == browser
                    && Column("endedAt") == nil)
                .order(Column("startedAt").desc)
                .fetchOne(database)
        }
    }

    // MARK: - Cleanup by retention

    func deleteEventsOlderThan(date: Date) throws {
        let threshold = date.timeIntervalSince1970
        try db.write { database in
            try database.execute(
                sql: "DELETE FROM activity_events WHERE timestamp < ?",
                arguments: [threshold]
            )
            try database.execute(
                sql: "DELETE FROM app_sessions WHERE startedAt < ?",
                arguments: [threshold]
            )
            try database.execute(
                sql: "DELETE FROM browser_sessions WHERE startedAt < ?",
                arguments: [threshold]
            )
            try database.execute(
                sql: "DELETE FROM website_visits WHERE startedAt < ?",
                arguments: [threshold]
            )
        }
    }

    func deleteAllData() throws {
        try db.write { database in
            try database.execute(sql: "DELETE FROM activity_events")
            try database.execute(sql: "DELETE FROM app_sessions")
            try database.execute(sql: "DELETE FROM browser_sessions")
            try database.execute(sql: "DELETE FROM website_visits")
            try database.execute(sql: "DELETE FROM daily_summaries")
            try database.execute(sql: "DELETE FROM ai_conversations")
        }
    }
}
