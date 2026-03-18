import XCTest
@testable import DayLens

final class DatabaseTests: XCTestCase {
    private var db: AppDatabase!

    override func setUp() async throws {
        db = try AppDatabase.makeInMemory()
    }

    // MARK: - Schema existence

    func testAllTablesExist() throws {
        let tables = try db.read { database -> [String] in
            let rows = try Row.fetchAll(
                database,
                sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            return rows.map { $0["name"] as! String }
        }

        let expected = [
            "activity_events", "ai_conversations", "app_sessions",
            "browser_sessions", "daily_summaries", "grdb_migrations",
            "user_settings", "website_visits"
        ]
        for table in expected where table != "grdb_migrations" {
            XCTAssertTrue(tables.contains(table), "Missing table: \(table)")
        }
    }

    // MARK: - Insert and fetch roundtrip

    func testActivityEventInsertAndFetch() throws {
        let event = ActivityEvent(
            eventType: .appActivated,
            appBundleId: "com.apple.dt.Xcode",
            appName: "Xcode",
            source: .nsworkspace
        )

        try db.write { database in try event.insert(database) }

        let fetched = try db.read { database in
            try ActivityEvent.filter(Column("id") == event.id).fetchOne(database)
        }

        XCTAssertNotNil(fetched)
        XCTAssertEqual(fetched?.appBundleId, "com.apple.dt.Xcode")
        XCTAssertEqual(fetched?.eventType, ActivityEventType.appActivated.rawValue)
        XCTAssertEqual(fetched?.confidence, 1.0)
    }

    func testAppSessionInsertAndFetch() throws {
        let session = AppSession(
            appBundleId: "com.apple.Safari",
            appName: "Safari",
            startedAt: 1_700_000_000,
            endedAt: 1_700_003_600,
            activeDuration: 3600,
            dateKey: "2024-01-15"
        )

        try db.write { database in try session.insert(database) }

        let fetched = try db.read { database in
            try AppSession.filter(Column("id") == session.id).fetchOne(database)
        }

        XCTAssertNotNil(fetched)
        XCTAssertEqual(fetched?.appName, "Safari")
        XCTAssertEqual(fetched?.activeDuration, 3600, accuracy: 0.1)
        XCTAssertEqual(fetched?.dateKey, "2024-01-15")
    }

    func testWebsiteVisitPrivacyRedaction() throws {
        // Private visits must have nil pageTitle and urlSlug
        let visit = WebsiteVisit(
            domain: "private.example.com",
            pageTitle: "Secret Page Title",
            urlSlug: "/secret-path",
            browserName: "chrome",
            startedAt: 1_700_000_000,
            isPrivate: true
        )

        XCTAssertNil(visit.pageTitle, "Private visit pageTitle must be nil")
        XCTAssertNil(visit.urlSlug, "Private visit urlSlug must be nil")
        XCTAssertEqual(visit.domain, "private.example.com")
        XCTAssertTrue(visit.isPrivate)
    }

    func testUserSettingsSaveAndLoad() throws {
        let settings = UserSettings()
        settings.anthropicApiKey = "sk-ant-test"
        settings.selectedAIModel = .opus
        settings.isTrackingPaused = true

        try db.write { database in
            for row in settings.toRows() {
                try row.save(database)
            }
        }

        let loaded = UserSettings()
        let rows = try db.read { database in try UserSettingRow.fetchAll(database) }
        loaded.load(from: rows)

        XCTAssertEqual(loaded.anthropicApiKey, "sk-ant-test")
        XCTAssertEqual(loaded.selectedAIModel, .opus)
        XCTAssertTrue(loaded.isTrackingPaused)
    }

    // MARK: - Retention / delete

    func testDeleteAllDataClearsAllTables() throws {
        let event = ActivityEvent(eventType: .appActivated, appBundleId: "com.test", appName: "Test", source: .nsworkspace)
        let session = AppSession(appBundleId: "com.test", appName: "Test", startedAt: 1_700_000_000, activeDuration: 60, dateKey: "2024-01-15")

        try db.write { database in
            try event.insert(database)
            try session.insert(database)
        }

        let activityRepo = ActivityRepository(db: db)
        try activityRepo.deleteAllData()

        let eventCount = try db.read { database in
            try Int.fetchOne(database, sql: "SELECT COUNT(*) FROM activity_events") ?? 0
        }
        let sessionCount = try db.read { database in
            try Int.fetchOne(database, sql: "SELECT COUNT(*) FROM app_sessions") ?? 0
        }

        XCTAssertEqual(eventCount, 0)
        XCTAssertEqual(sessionCount, 0)
    }
}
