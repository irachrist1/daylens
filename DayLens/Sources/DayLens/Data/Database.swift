import Foundation
import GRDB

// MARK: - Database setup and migrations

final class AppDatabase {
    private let dbPool: DatabasePool

    /// Shared singleton for the main app database.
    static let shared: AppDatabase = {
        let url = Self.databaseURL()
        return try! AppDatabase(path: url.path)
    }()

    init(path: String) throws {
        var config = Configuration()
        config.label = "DayLens"
        // Enable WAL mode for better concurrent read performance
        config.prepareDatabase { db in
            try db.execute(sql: "PRAGMA journal_mode = WAL")
            try db.execute(sql: "PRAGMA foreign_keys = ON")
            // Tune for low-overhead background writes
            try db.execute(sql: "PRAGMA synchronous = NORMAL")
            try db.execute(sql: "PRAGMA cache_size = -8000")  // 8MB page cache
        }
        dbPool = try DatabasePool(path: path, configuration: config)
        try runMigrations()
    }

    /// In-memory database for tests
    static func makeInMemory() throws -> AppDatabase {
        let db = AppDatabase.__unsafeInit_inMemory()
        return db
    }

    private static func __unsafeInit_inMemory() -> AppDatabase {
        // Used only in tests; force-try is intentional
        try! AppDatabase(path: ":memory:")
    }

    private static func databaseURL() -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = appSupport.appendingPathComponent("DayLens", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("daylens.db")
    }

    // MARK: - Public database access

    /// Read-only access (can run multiple concurrent reads)
    func read<T>(_ block: (Database) throws -> T) throws -> T {
        try dbPool.read(block)
    }

    /// Write access (serialized)
    @discardableResult
    func write<T>(_ block: (Database) throws -> T) throws -> T {
        try dbPool.write(block)
    }

    // MARK: - Migrations

    private func runMigrations() throws {
        var migrator = DatabaseMigrator()

        // v1: initial schema
        migrator.registerMigration("v1_initial_schema") { db in
            try db.create(table: "activity_events") { t in
                t.column("id", .text).primaryKey()
                t.column("timestamp", .double).notNull().indexed()
                t.column("eventType", .text).notNull()
                t.column("appBundleId", .text)
                t.column("appName", .text)
                t.column("browserName", .text)
                t.column("domain", .text)
                t.column("pageTitle", .text)
                t.column("urlSlug", .text)
                t.column("isPrivate", .integer).notNull().defaults(to: 0)
                t.column("source", .text).notNull()
                t.column("confidence", .double).notNull().defaults(to: 1.0)
            }

            try db.create(table: "app_sessions") { t in
                t.column("id", .text).primaryKey()
                t.column("appBundleId", .text).notNull().indexed()
                t.column("appName", .text).notNull()
                t.column("appIconPath", .text)
                t.column("startedAt", .double).notNull().indexed()
                t.column("endedAt", .double)
                t.column("activeDuration", .double).notNull().defaults(to: 0)
                t.column("wasIdle", .integer).notNull().defaults(to: 0)
                t.column("dateKey", .text).notNull().indexed()
            }

            try db.create(table: "browser_sessions") { t in
                t.column("id", .text).primaryKey()
                t.column("browserBundleId", .text).notNull().indexed()
                t.column("browserName", .text).notNull()
                t.column("startedAt", .double).notNull().indexed()
                t.column("endedAt", .double)
                t.column("activeDuration", .double).notNull().defaults(to: 0)
                t.column("dateKey", .text).notNull().indexed()
            }

            try db.create(table: "website_visits") { t in
                t.column("id", .text).primaryKey()
                t.column("domain", .text).notNull().indexed()
                t.column("pageTitle", .text)
                t.column("urlSlug", .text)
                t.column("browserName", .text).notNull()
                t.column("startedAt", .double).notNull().indexed()
                t.column("endedAt", .double)
                t.column("duration", .double).notNull().defaults(to: 0)
                t.column("isPrivate", .integer).notNull().defaults(to: 0)
                t.column("confidence", .double).notNull().defaults(to: 1.0)
                t.column("dateKey", .text).notNull().indexed()
            }

            try db.create(table: "daily_summaries") { t in
                t.column("id", .text).primaryKey()
                t.column("dateKey", .text).notNull().unique()
                t.column("totalActiveSeconds", .double).notNull().defaults(to: 0)
                t.column("topAppsJson", .text)
                t.column("topSitesJson", .text)
                t.column("focusScore", .double)
                t.column("fragmentCount", .integer)
                t.column("aiNarrative", .text)
                t.column("aiModelUsed", .text)
                t.column("generatedAt", .double)
            }

            try db.create(table: "ai_conversations") { t in
                t.column("id", .text).primaryKey()
                t.column("startedAt", .double).notNull()
                t.column("messagesJson", .text).notNull()
            }

            try db.create(table: "user_settings") { t in
                t.column("key", .text).primaryKey()
                t.column("value", .text).notNull()
            }
        }

        #if DEBUG
        migrator.eraseDatabaseOnSchemaChange = false
        #endif

        try migrator.migrate(dbPool)
    }
}
