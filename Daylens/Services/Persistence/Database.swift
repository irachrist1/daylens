import Foundation
import GRDB

/// Manages the GRDB database connection and migrations.
final class AppDatabase {
    static let shared: AppDatabase = {
        do {
            return try AppDatabase()
        } catch {
            fatalError("AppDatabase failed to initialize: \(error)")
        }
    }()

    let dbQueue: DatabaseQueue

    init(dbQueue: DatabaseQueue) throws {
        self.dbQueue = dbQueue
        try Self.migrator.migrate(dbQueue)
    }

    convenience init() throws {
        let fileManager = FileManager.default
        let appSupportURL = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let daylensDir = appSupportURL.appendingPathComponent("Daylens", isDirectory: true)

        try fileManager.createDirectory(at: daylensDir, withIntermediateDirectories: true)

        let dbURL = daylensDir.appendingPathComponent("daylens.sqlite")

        let shouldLogSQL = ProcessInfo.processInfo.environment["DAYLENS_LOG_SQL"] == "1"
        let dbQueue = try DatabaseQueue(path: dbURL.path, configuration: Self.makeConfiguration(logSQL: shouldLogSQL))
        try self.init(dbQueue: dbQueue)

        // Take a rolling backup after the connection is open, off the main thread.
        let capturedDirURL = daylensDir
        let capturedDBURL = dbURL
        Task.detached(priority: .utility) {
            Self.takeBackup(of: capturedDBURL, in: capturedDirURL)
        }
    }

    // MARK: - Backup

    /// Copies the database to a dated backup file, keeping only the last `maxBackups` files.
    private static func takeBackup(of dbURL: URL, in daylensDir: URL, maxBackups: Int = 7) {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: dbURL.path) else { return }

        let backupDir = daylensDir.appendingPathComponent("Backups", isDirectory: true)
        try? fileManager.createDirectory(at: backupDir, withIntermediateDirectories: true)

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateString = formatter.string(from: Date())
        let backupURL = backupDir.appendingPathComponent("daylens_\(dateString).sqlite")

        // One backup per calendar day — skip if today's already exists
        guard !fileManager.fileExists(atPath: backupURL.path) else { return }

        try? fileManager.copyItem(at: dbURL, to: backupURL)

        // Prune old backups beyond the limit
        let backups = (try? fileManager.contentsOfDirectory(
            at: backupDir,
            includingPropertiesForKeys: [.creationDateKey],
            options: .skipsHiddenFiles
        ))?.filter { $0.pathExtension == "sqlite" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent } ?? []

        if backups.count > maxBackups {
            for old in backups.prefix(backups.count - maxBackups) {
                try? fileManager.removeItem(at: old)
            }
        }
    }

    static func inMemory() throws -> AppDatabase {
        let dbQueue = try DatabaseQueue(path: ":memory:", configuration: makeConfiguration())
        return try AppDatabase(dbQueue: dbQueue)
    }

    // MARK: - Migrations

    private static func makeConfiguration(logSQL: Bool = false) -> Configuration {
        var config = Configuration()
        config.foreignKeysEnabled = true

        if logSQL {
            config.prepareDatabase { db in
                db.trace { print("SQL: \($0)") }
            }
        }

        return config
    }

    private static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

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

        migrator.registerMigration("v2_focus_sessions") { db in
            try db.create(table: "focus_sessions") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("date", .date).notNull().indexed()
                t.column("startTime", .datetime).notNull().indexed()
                t.column("endTime", .datetime)
                t.column("targetMinutes", .integer).notNull()
                t.column("actualDuration", .double).notNull().defaults(to: 0)
                t.column("status", .text).notNull()
            }
        }

        migrator.registerMigration("v3_category_overrides") { db in
            try db.create(table: "category_overrides") { t in
                t.column("bundleID", .text).primaryKey()
                t.column("category", .text).notNull()
            }
        }

        migrator.registerMigration("v4_focus_session_label") { db in
            try db.alter(table: "focus_sessions") { t in
                t.add(column: "label", .text)
            }
        }

        return migrator
    }
}
