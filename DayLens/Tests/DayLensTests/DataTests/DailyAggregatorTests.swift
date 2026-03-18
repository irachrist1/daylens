import XCTest
@testable import DayLens

final class DailyAggregatorTests: XCTestCase {
    private var db: AppDatabase!
    private var repo: ActivityRepository!
    private var aggregator: DailyAggregator!

    private let testDateKey = "2024-01-15"
    private let baseTimestamp: Double = 1_705_312_800  // 2024-01-15 09:00 UTC

    override func setUp() async throws {
        db = try AppDatabase.makeInMemory()
        repo = ActivityRepository(db: db)
        aggregator = DailyAggregator(db: db)
    }

    // MARK: - Total active seconds

    func testTotalActiveSecondsWithNoData() throws {
        let total = try aggregator.totalActiveSeconds(for: testDateKey)
        XCTAssertEqual(total, 0)
    }

    func testTotalActiveSecondsAggregatesCorrectly() throws {
        // Insert 3 sessions: 3600s, 1800s, 900s
        let sessions: [AppSession] = [
            AppSession(appBundleId: "com.apple.dt.Xcode", appName: "Xcode",
                       startedAt: baseTimestamp, endedAt: baseTimestamp + 3600,
                       activeDuration: 3600, dateKey: testDateKey),
            AppSession(appBundleId: "com.tinyspeck.slackmacgap", appName: "Slack",
                       startedAt: baseTimestamp + 4000, endedAt: baseTimestamp + 5800,
                       activeDuration: 1800, dateKey: testDateKey),
            AppSession(appBundleId: "com.apple.Safari", appName: "Safari",
                       startedAt: baseTimestamp + 6000, endedAt: baseTimestamp + 6900,
                       activeDuration: 900, dateKey: testDateKey)
        ]
        try db.write { database in
            for s in sessions { try s.insert(database) }
        }

        let total = try aggregator.totalActiveSeconds(for: testDateKey)
        XCTAssertEqual(total, 6300, accuracy: 1)
    }

    // MARK: - Top apps

    func testTopAppsOrderedByDuration() throws {
        let sessions: [AppSession] = [
            AppSession(appBundleId: "com.tinyspeck.slackmacgap", appName: "Slack",
                       startedAt: baseTimestamp, endedAt: baseTimestamp + 3600,
                       activeDuration: 3600, dateKey: testDateKey),
            AppSession(appBundleId: "com.apple.dt.Xcode", appName: "Xcode",
                       startedAt: baseTimestamp + 4000, endedAt: baseTimestamp + 10400,
                       activeDuration: 6400, dateKey: testDateKey),
            AppSession(appBundleId: "com.apple.Safari", appName: "Safari",
                       startedAt: baseTimestamp + 11000, endedAt: baseTimestamp + 11900,
                       activeDuration: 900, dateKey: testDateKey)
        ]
        try db.write { database in
            for s in sessions { try s.insert(database) }
        }

        let top = try aggregator.topApps(for: testDateKey, limit: 10)
        XCTAssertEqual(top.count, 3)
        XCTAssertEqual(top[0].appName, "Xcode", "Xcode should be #1 with 6400s")
        XCTAssertEqual(top[1].appName, "Slack")
        XCTAssertEqual(top[2].appName, "Safari")
    }

    func testTopAppsExcludesSubThresholdSessions() throws {
        // Insert one session with < 5s active duration
        let shortSession = AppSession(
            appBundleId: "com.apple.dt.Xcode", appName: "Xcode",
            startedAt: baseTimestamp, endedAt: baseTimestamp + 3,
            activeDuration: 3, dateKey: testDateKey
        )
        try db.write { database in try shortSession.insert(database) }

        let top = try aggregator.topApps(for: testDateKey)
        XCTAssertTrue(top.isEmpty, "Sessions shorter than 5s should be excluded from top apps")
    }

    // MARK: - Top websites

    func testTopWebsitesAggregatesByDomain() throws {
        let visits: [WebsiteVisit] = [
            WebsiteVisit(domain: "youtube.com", browserName: "chrome",
                         startedAt: baseTimestamp, endedAt: baseTimestamp + 720,
                         duration: 720, dateKey: testDateKey),
            WebsiteVisit(domain: "youtube.com", browserName: "chrome",
                         startedAt: baseTimestamp + 1000, endedAt: baseTimestamp + 1300,
                         duration: 300, dateKey: testDateKey),
            WebsiteVisit(domain: "github.com", browserName: "chrome",
                         startedAt: baseTimestamp + 2000, endedAt: baseTimestamp + 2600,
                         duration: 600, dateKey: testDateKey)
        ]
        try db.write { database in
            for v in visits { try v.insert(database) }
        }

        let top = try aggregator.topWebsites(for: testDateKey)
        XCTAssertEqual(top.count, 2)
        XCTAssertEqual(top[0].domain, "youtube.com")
        XCTAssertEqual(top[0].totalSeconds, 1020, accuracy: 1)
        XCTAssertEqual(top[0].visitCount, 2)
    }

    func testTopWebsitesExcludesPrivateSessions() throws {
        let privateVisit = WebsiteVisit(
            domain: "secret.com", browserName: "chrome",
            startedAt: baseTimestamp, endedAt: baseTimestamp + 3600,
            duration: 3600, isPrivate: true, dateKey: testDateKey
        )
        try db.write { database in try privateVisit.insert(database) }

        let top = try aggregator.topWebsites(for: testDateKey)
        XCTAssertTrue(top.isEmpty, "Private visits must not appear in top websites")
    }

    // MARK: - Context switch count

    func testContextSwitchCount() throws {
        let sessions: [AppSession] = (0..<5).map { i in
            let bundleId = i % 2 == 0 ? "com.apple.dt.Xcode" : "com.tinyspeck.slackmacgap"
            return AppSession(appBundleId: bundleId, appName: i % 2 == 0 ? "Xcode" : "Slack",
                              startedAt: baseTimestamp + Double(i * 300),
                              endedAt: baseTimestamp + Double(i * 300 + 290),
                              activeDuration: 290, dateKey: testDateKey)
        }
        try db.write { database in
            for s in sessions { try s.insert(database) }
        }

        let switchCount = try aggregator.contextSwitchCount(for: testDateKey)
        XCTAssertEqual(switchCount, 5)
    }

    // MARK: - AI snapshot

    func testAIDataSnapshotContainsRequiredKeys() throws {
        let sessions: [AppSession] = [
            AppSession(appBundleId: "com.apple.dt.Xcode", appName: "Xcode",
                       startedAt: baseTimestamp, endedAt: baseTimestamp + 3600,
                       activeDuration: 3600, dateKey: testDateKey)
        ]
        try db.write { database in
            for s in sessions { try s.insert(database) }
        }

        let snapshot = try aggregator.buildAIDataSnapshot(for: testDateKey)
        XCTAssertNotNil(snapshot["dateKey"])
        XCTAssertNotNil(snapshot["totalActiveSeconds"])
        XCTAssertNotNil(snapshot["focusScore"])
        XCTAssertNotNil(snapshot["contextSwitchCount"])
        XCTAssertNotNil(snapshot["topApps"])
        XCTAssertNotNil(snapshot["topSites"])
        XCTAssertNotNil(snapshot["topBrowsers"])
    }
}
