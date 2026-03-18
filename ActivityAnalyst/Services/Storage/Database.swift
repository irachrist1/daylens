import Foundation
#if canImport(GRDB)
import GRDB
#endif

/// Manages the SQLite database lifecycle, migrations, and connection pooling.
final class Database: Sendable {
    #if canImport(GRDB)
    let dbPool: DatabasePool

    init(path: String? = nil) throws {
        let databasePath: String
        if let path = path {
            databasePath = path
        } else {
            let appSupport = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first!
            let appDir = appSupport.appendingPathComponent("ActivityAnalyst", isDirectory: true)
            try FileManager.default.createDirectory(at: appDir, withIntermediateDirectories: true)
            databasePath = appDir.appendingPathComponent("activity.sqlite").path
        }

        var config = Configuration()
        config.prepareDatabase { db in
            db.trace { print("SQL: \($0)") }
        }
        config.foreignKeysEnabled = true
        config.readonly = false

        dbPool = try DatabasePool(path: databasePath, configuration: config)
        try migrator.migrate(dbPool)
    }

    /// In-memory database for testing
    static func inMemory() throws -> Database {
        let instance = try Database(inMemory: true)
        return instance
    }

    private init(inMemory: Bool) throws {
        var config = Configuration()
        config.foreignKeysEnabled = true
        dbPool = try DatabasePool(path: ":memory:", configuration: config)
        try migrator.migrate(dbPool)
    }

    // MARK: - Migrations

    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        #if DEBUG
        migrator.eraseDatabaseOnSchemaChange = true
        #endif

        migrator.registerMigration("v1_initial") { db in
            try db.create(table: "users") { t in
                t.column("id", .text).primaryKey()
                t.column("displayName", .text)
                t.column("createdAt", .datetime).notNull()
                t.column("lastActiveAt", .datetime).notNull()
                t.column("onboardingCompleted", .boolean).notNull().defaults(to: false)
                t.column("selectedAIModel", .text).notNull().defaults(to: "claude-sonnet-4-20250514")
                t.column("apiKeyConfigured", .boolean).notNull().defaults(to: false)
            }

            try db.create(table: "devices") { t in
                t.column("id", .text).primaryKey()
                t.column("userId", .text).notNull()
                    .references("users", onDelete: .cascade)
                t.column("name", .text).notNull()
                t.column("model", .text).notNull()
                t.column("osVersion", .text).notNull()
                t.column("appVersion", .text).notNull()
                t.column("firstSeen", .datetime).notNull()
                t.column("lastSeen", .datetime).notNull()
            }

            try db.create(table: "apps") { t in
                t.column("id", .text).primaryKey()
                t.column("bundleIdentifier", .text).notNull().unique()
                t.column("name", .text).notNull()
                t.column("category", .text).notNull().defaults(to: "uncategorized")
                t.column("isBlocked", .boolean).notNull().defaults(to: false)
                t.column("firstSeen", .datetime).notNull()
                t.column("iconData", .blob)
            }

            try db.create(table: "browsers") { t in
                t.column("id", .text).primaryKey()
                t.column("bundleIdentifier", .text).notNull().unique()
                t.column("name", .text).notNull()
                t.column("extensionInstalled", .boolean).notNull().defaults(to: false)
                t.column("firstSeen", .datetime).notNull()
            }

            try db.create(table: "websites") { t in
                t.column("id", .text).primaryKey()
                t.column("domain", .text).notNull().unique()
                t.column("category", .text).notNull().defaults(to: "uncategorized")
                t.column("isBlocked", .boolean).notNull().defaults(to: false)
                t.column("firstSeen", .datetime).notNull()
            }

            try db.create(table: "activity_events") { t in
                t.column("id", .text).primaryKey()
                t.column("timestamp", .datetime).notNull()
                t.column("eventType", .text).notNull()
                t.column("appId", .text).notNull()
                t.column("browserId", .text)
                t.column("websiteId", .text)
                t.column("windowTitle", .text)
                t.column("url", .text)
                t.column("pageTitle", .text)
                t.column("source", .text).notNull()
                t.column("confidence", .double).notNull().defaults(to: 1.0)
                t.column("isPrivateBrowsing", .boolean).notNull().defaults(to: false)
                t.column("metadata", .text)
            }

            try db.create(index: "idx_events_timestamp", on: "activity_events", columns: ["timestamp"])
            try db.create(index: "idx_events_app", on: "activity_events", columns: ["appId"])
            try db.create(index: "idx_events_type", on: "activity_events", columns: ["eventType"])

            try db.create(table: "sessions") { t in
                t.column("id", .text).primaryKey()
                t.column("appId", .text).notNull()
                t.column("browserId", .text)
                t.column("websiteId", .text)
                t.column("startTime", .datetime).notNull()
                t.column("endTime", .datetime).notNull()
                t.column("duration", .double).notNull()
                t.column("idleDuration", .double).notNull().defaults(to: 0)
                t.column("eventCount", .integer).notNull().defaults(to: 1)
                t.column("source", .text).notNull()
                t.column("confidence", .double).notNull().defaults(to: 1.0)
                t.column("category", .text).notNull().defaults(to: "uncategorized")
                t.column("isSignificant", .boolean).notNull().defaults(to: true)
            }

            try db.create(index: "idx_sessions_time", on: "sessions", columns: ["startTime", "endTime"])
            try db.create(index: "idx_sessions_app", on: "sessions", columns: ["appId"])
            try db.create(index: "idx_sessions_significant", on: "sessions", columns: ["isSignificant"])

            try db.create(table: "daily_summaries") { t in
                t.column("id", .text).primaryKey()
                t.column("date", .date).notNull().unique()
                t.column("totalActiveTime", .double).notNull().defaults(to: 0)
                t.column("totalIdleTime", .double).notNull().defaults(to: 0)
                t.column("topApps", .text).notNull().defaults(to: "[]")
                t.column("topBrowsers", .text).notNull().defaults(to: "[]")
                t.column("topWebsites", .text).notNull().defaults(to: "[]")
                t.column("focusScore", .double).notNull().defaults(to: 0)
                t.column("fragmentationScore", .double).notNull().defaults(to: 0)
                t.column("sessionCount", .integer).notNull().defaults(to: 0)
                t.column("switchCount", .integer).notNull().defaults(to: 0)
                t.column("aiSummary", .text)
                t.column("generatedAt", .datetime)
            }

            try db.create(table: "insights") { t in
                t.column("id", .text).primaryKey()
                t.column("dailySummaryId", .text).notNull()
                    .references("daily_summaries", onDelete: .cascade)
                t.column("type", .text).notNull()
                t.column("title", .text).notNull()
                t.column("body", .text).notNull()
                t.column("evidence", .text).notNull().defaults(to: "[]")
                t.column("createdAt", .datetime).notNull()
            }

            try db.create(table: "ai_conversations") { t in
                t.column("id", .text).primaryKey()
                t.column("createdAt", .datetime).notNull()
                t.column("title", .text)
                t.column("lastMessageAt", .datetime)
            }

            try db.create(table: "ai_messages") { t in
                t.column("id", .text).primaryKey()
                t.column("conversationId", .text).notNull()
                    .references("ai_conversations", onDelete: .cascade)
                t.column("role", .text).notNull()
                t.column("content", .text).notNull()
                t.column("evidence", .text)
                t.column("createdAt", .datetime).notNull()
            }

            try db.create(index: "idx_messages_conversation", on: "ai_messages", columns: ["conversationId"])
        }

        return migrator
    }

    // MARK: - Convenience

    func read<T>(_ block: (GRDB.Database) throws -> T) throws -> T {
        try dbPool.read(block)
    }

    func write<T>(_ block: (GRDB.Database) throws -> T) throws -> T {
        try dbPool.write(block)
    }
    #endif
}
