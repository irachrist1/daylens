import Foundation
import GRDB

/// Manages the GRDB database connection and migrations.
final class AppDatabase {
    static let shared = AppDatabase()

    let dbQueue: DatabaseQueue

    private init() {
        let fileManager = FileManager.default
        let appSupportURL = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let daylensDir = appSupportURL.appendingPathComponent("Daylens", isDirectory: true)

        try! fileManager.createDirectory(at: daylensDir, withIntermediateDirectories: true)

        let dbURL = daylensDir.appendingPathComponent("daylens.sqlite")

        var config = Configuration()
        config.foreignKeysEnabled = true
        config.prepareDatabase { db in
            db.trace { print("SQL: \($0)") }
        }

        dbQueue = try! DatabaseQueue(path: dbURL.path, configuration: config)
        try! migrator.migrate(dbQueue)
    }

    // MARK: - Migrations

    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        #if DEBUG
        migrator.eraseDatabaseOnSchemaChange = true
        #endif

        migrator.registerMigration("v1_create_tables") { db in
            try db.create(table: "activity_events") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("timestamp", .datetime).notNull().indexed()
                t.column("eventType", .text).notNull()
                t.column("bundleID", .text).notNull().indexed()
                t.column("appName", .text).notNull()
                t.column("windowTitle", .text)
                t.column("domain", .text)
                t.column("pageTitle", .text)
                t.column("duration", .double)
                t.column("isIdle", .boolean).notNull().defaults(to: false)
                t.column("confidence", .text).notNull().defaults(to: "low")
                t.column("source", .text).notNull()
            }

            try db.create(table: "app_sessions") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("date", .date).notNull().indexed()
                t.column("bundleID", .text).notNull().indexed()
                t.column("appName", .text).notNull()
                t.column("startTime", .datetime).notNull()
                t.column("endTime", .datetime).notNull()
                t.column("duration", .double).notNull()
                t.column("category", .text).notNull()
                t.column("isBrowser", .boolean).notNull().defaults(to: false)
            }

            try db.create(table: "browser_sessions") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("date", .date).notNull().indexed()
                t.column("browserBundleID", .text).notNull()
                t.column("browserName", .text).notNull()
                t.column("startTime", .datetime).notNull()
                t.column("endTime", .datetime).notNull()
                t.column("duration", .double).notNull()
            }

            try db.create(table: "website_visits") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("date", .date).notNull().indexed()
                t.column("domain", .text).notNull().indexed()
                t.column("fullURL", .text)
                t.column("pageTitle", .text)
                t.column("browserBundleID", .text).notNull()
                t.column("startTime", .datetime).notNull()
                t.column("endTime", .datetime).notNull()
                t.column("duration", .double).notNull()
                t.column("confidence", .text).notNull()
                t.column("source", .text).notNull()
            }

            try db.create(table: "daily_summaries") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("date", .date).notNull().unique().indexed()
                t.column("totalActiveTime", .double).notNull().defaults(to: 0)
                t.column("totalIdleTime", .double).notNull().defaults(to: 0)
                t.column("appCount", .integer).notNull().defaults(to: 0)
                t.column("browserCount", .integer).notNull().defaults(to: 0)
                t.column("domainCount", .integer).notNull().defaults(to: 0)
                t.column("sessionCount", .integer).notNull().defaults(to: 0)
                t.column("contextSwitches", .integer).notNull().defaults(to: 0)
                t.column("focusScore", .double).notNull().defaults(to: 0)
                t.column("longestFocusStreak", .double).notNull().defaults(to: 0)
                t.column("topAppBundleID", .text)
                t.column("topDomain", .text)
                t.column("aiSummary", .text)
                t.column("aiSummaryGeneratedAt", .datetime)
            }

            try db.create(table: "ai_conversations") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("createdAt", .datetime).notNull()
                t.column("question", .text).notNull()
                t.column("answer", .text).notNull()
                t.column("date", .date) // Optional: which day the question was about
            }
        }

        return migrator
    }
}
