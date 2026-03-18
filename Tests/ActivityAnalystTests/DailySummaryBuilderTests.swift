import XCTest
@testable import ActivityAnalystCore

final class DailySummaryBuilderTests: XCTestCase {

    let app1Id = UUID()
    let app2Id = UUID()
    let browser1Id = UUID()
    let website1Id = UUID()
    let website2Id = UUID()

    private func makeSession(
        appId: UUID,
        browserId: UUID? = nil,
        websiteId: UUID? = nil,
        duration: TimeInterval,
        category: ActivityCategory = .uncategorized,
        isSignificant: Bool = true
    ) -> Session {
        let start = Date()
        return Session(
            appId: appId,
            browserId: browserId,
            websiteId: websiteId,
            startTime: start,
            endTime: start.addingTimeInterval(duration),
            duration: duration,
            category: category,
            isSignificant: isSignificant
        )
    }

    func testSummaryCalculatesTotalActiveTime() {
        let sessions = [
            makeSession(appId: app1Id, duration: 3600),
            makeSession(appId: app2Id, duration: 1800),
        ]

        let builder = DailySummaryBuilder(
            date: Date(),
            sessions: sessions,
            apps: [
                app1Id: AppRecord(id: app1Id, bundleIdentifier: "com.test.app1", name: "App 1"),
                app2Id: AppRecord(id: app2Id, bundleIdentifier: "com.test.app2", name: "App 2"),
            ],
            browsers: [:],
            websites: [:]
        )

        let summary = builder.build()
        XCTAssertEqual(summary.totalActiveTime, 5400, accuracy: 0.1)
    }

    func testSummaryRanksAppsByDuration() {
        let sessions = [
            makeSession(appId: app1Id, duration: 1000),
            makeSession(appId: app2Id, duration: 3000),
            makeSession(appId: app1Id, duration: 500),
        ]

        let builder = DailySummaryBuilder(
            date: Date(),
            sessions: sessions,
            apps: [
                app1Id: AppRecord(id: app1Id, bundleIdentifier: "com.test.app1", name: "App 1"),
                app2Id: AppRecord(id: app2Id, bundleIdentifier: "com.test.app2", name: "App 2"),
            ],
            browsers: [:],
            websites: [:]
        )

        let summary = builder.build()
        XCTAssertEqual(summary.topApps.count, 2)
        XCTAssertEqual(summary.topApps[0].name, "App 2", "Higher duration app should rank first")
        XCTAssertEqual(summary.topApps[0].duration, 3000, accuracy: 0.1)
        XCTAssertEqual(summary.topApps[1].name, "App 1")
        XCTAssertEqual(summary.topApps[1].duration, 1500, accuracy: 0.1)
    }

    func testSummaryIncludesWebsites() {
        let sessions = [
            makeSession(appId: app1Id, websiteId: website1Id, duration: 600),
            makeSession(appId: app1Id, websiteId: website2Id, duration: 1200),
        ]

        let builder = DailySummaryBuilder(
            date: Date(),
            sessions: sessions,
            apps: [app1Id: AppRecord(id: app1Id, bundleIdentifier: "com.test", name: "Chrome")],
            browsers: [:],
            websites: [
                website1Id: WebsiteRecord(id: website1Id, domain: "github.com"),
                website2Id: WebsiteRecord(id: website2Id, domain: "youtube.com"),
            ]
        )

        let summary = builder.build()
        XCTAssertEqual(summary.topWebsites.count, 2)
        XCTAssertEqual(summary.topWebsites[0].name, "youtube.com")
    }

    func testSummaryExcludesInsignificantSessions() {
        let sessions = [
            makeSession(appId: app1Id, duration: 3600, isSignificant: true),
            makeSession(appId: app2Id, duration: 2, isSignificant: false),
        ]

        let builder = DailySummaryBuilder(
            date: Date(),
            sessions: sessions,
            apps: [
                app1Id: AppRecord(id: app1Id, bundleIdentifier: "com.test.app1", name: "App 1"),
                app2Id: AppRecord(id: app2Id, bundleIdentifier: "com.test.app2", name: "App 2"),
            ],
            browsers: [:],
            websites: [:]
        )

        let summary = builder.build()
        XCTAssertEqual(summary.totalActiveTime, 3600, accuracy: 0.1)
        XCTAssertEqual(summary.sessionCount, 1)
    }

    func testSummaryCountsSwitches() {
        let start = Date()
        let sessions = [
            Session(appId: app1Id, startTime: start, endTime: start.addingTimeInterval(10), duration: 10, isSignificant: true),
            Session(appId: app2Id, startTime: start.addingTimeInterval(10), endTime: start.addingTimeInterval(20), duration: 10, isSignificant: true),
            Session(appId: app1Id, startTime: start.addingTimeInterval(20), endTime: start.addingTimeInterval(30), duration: 10, isSignificant: true),
        ]

        let builder = DailySummaryBuilder(
            date: Date(),
            sessions: sessions,
            apps: [
                app1Id: AppRecord(id: app1Id, bundleIdentifier: "com.test.app1", name: "App 1"),
                app2Id: AppRecord(id: app2Id, bundleIdentifier: "com.test.app2", name: "App 2"),
            ],
            browsers: [:],
            websites: [:]
        )

        let summary = builder.build()
        XCTAssertEqual(summary.switchCount, 2)
    }

    func testEmptySessionsProducesZeroSummary() {
        let builder = DailySummaryBuilder(
            date: Date(),
            sessions: [],
            apps: [:],
            browsers: [:],
            websites: [:]
        )

        let summary = builder.build()
        XCTAssertEqual(summary.totalActiveTime, 0)
        XCTAssertEqual(summary.sessionCount, 0)
        XCTAssertTrue(summary.topApps.isEmpty)
    }

    func testSummaryCalculatesPercentages() {
        let sessions = [
            makeSession(appId: app1Id, duration: 3000),
            makeSession(appId: app2Id, duration: 1000),
        ]

        let builder = DailySummaryBuilder(
            date: Date(),
            sessions: sessions,
            apps: [
                app1Id: AppRecord(id: app1Id, bundleIdentifier: "com.test.app1", name: "App 1"),
                app2Id: AppRecord(id: app2Id, bundleIdentifier: "com.test.app2", name: "App 2"),
            ],
            browsers: [:],
            websites: [:]
        )

        let summary = builder.build()
        XCTAssertEqual(summary.topApps[0].percentage, 0.75, accuracy: 0.01)
        XCTAssertEqual(summary.topApps[1].percentage, 0.25, accuracy: 0.01)
    }
}
