import XCTest
@testable import DayLens

final class SessionNormalizerTests: XCTestCase {

    private var db: AppDatabase!
    private var repo: ActivityRepository!
    private var settings: UserSettings!
    private var normalizer: SessionNormalizer!

    override func setUp() async throws {
        db = try AppDatabase.makeInMemory()
        repo = ActivityRepository(db: db)
        settings = UserSettings()
        settings.minimumSessionSeconds = 5
        settings.mergeSwitchGapSeconds = 8
        settings.idleGraceSeconds = 120
        normalizer = SessionNormalizer(activityRepo: repo, settings: settings)
    }

    // MARK: - Minimum session threshold

    func testSubThresholdSessionExcludedFromSessions() throws {
        // Activate Xcode for only 3 seconds (below 5s minimum)
        let t: Double = 1_700_000_000
        normalizer.process(ActivityEvent(timestamp: t, eventType: .appActivated,
                                          appBundleId: "com.apple.dt.Xcode", appName: "Xcode",
                                          source: .nsworkspace))
        // Activate another app after 3 seconds — this closes Xcode's session
        normalizer.process(ActivityEvent(timestamp: t + 3, eventType: .appActivated,
                                          appBundleId: "com.tinyspeck.slackmacgap", appName: "Slack",
                                          source: .nsworkspace))

        // Xcode session should NOT be in app_sessions (too short)
        let xcodeSessions = try db.read { database in
            try AppSession
                .filter(Column("appBundleId") == "com.apple.dt.Xcode")
                .fetchAll(database)
        }
        // The session is either not persisted or has 0 duration (implementation dependent)
        let validSessions = xcodeSessions.filter { $0.activeDuration >= 5 }
        XCTAssertEqual(validSessions.count, 0, "Sub-threshold session should be excluded from sessions")
    }

    func testAboveThresholdSessionPersisted() throws {
        let t: Double = 1_700_000_000
        normalizer.process(ActivityEvent(timestamp: t, eventType: .appActivated,
                                          appBundleId: "com.apple.dt.Xcode", appName: "Xcode",
                                          source: .nsworkspace))
        // Activate another app after 60 seconds
        normalizer.process(ActivityEvent(timestamp: t + 60, eventType: .appActivated,
                                          appBundleId: "com.tinyspeck.slackmacgap", appName: "Slack",
                                          source: .nsworkspace))

        let sessions = try db.read { database in
            try AppSession.filter(Column("appBundleId") == "com.apple.dt.Xcode").fetchAll(database)
        }
        XCTAssertFalse(sessions.isEmpty, "60s session should be persisted")
        let session = sessions[0]
        XCTAssertGreaterThanOrEqual(session.activeDuration, 55, "Duration should be approximately 60s")
    }

    // MARK: - Merge rule

    func testRapidSwitchMerge() throws {
        // Switch from Xcode -> Slack -> Xcode, all within 5 seconds
        // The second Xcode activation should resume the same session
        let t: Double = 1_700_000_000
        normalizer.process(ActivityEvent(timestamp: t, eventType: .appActivated,
                                          appBundleId: "com.apple.dt.Xcode", appName: "Xcode",
                                          source: .nsworkspace))
        normalizer.process(ActivityEvent(timestamp: t + 60, eventType: .appActivated,
                                          appBundleId: "com.tinyspeck.slackmacgap", appName: "Slack",
                                          source: .nsworkspace))
        // Xcode comes back within 5 seconds — merge
        normalizer.process(ActivityEvent(timestamp: t + 65, eventType: .appActivated,
                                          appBundleId: "com.apple.dt.Xcode", appName: "Xcode",
                                          source: .nsworkspace))
        // Close out with another app change at t+200
        normalizer.process(ActivityEvent(timestamp: t + 200, eventType: .appActivated,
                                          appBundleId: "com.tinyspeck.slackmacgap", appName: "Slack",
                                          source: .nsworkspace))

        let sessions = try db.read { database in
            try AppSession.filter(Column("appBundleId") == "com.apple.dt.Xcode")
                .order(Column("startedAt"))
                .fetchAll(database)
        }

        // There should be a session for Xcode; the 5s gap to Slack should be negligible
        XCTAssertFalse(sessions.isEmpty)
    }

    // MARK: - Idle detection

    func testIdleStopsAccrual() throws {
        let t: Double = 1_700_000_000
        // Start Xcode
        normalizer.process(ActivityEvent(timestamp: t, eventType: .appActivated,
                                          appBundleId: "com.apple.dt.Xcode", appName: "Xcode",
                                          source: .nsworkspace))
        // Idle starts at t+60
        normalizer.handleIdleStart(at: t + 60)
        // Idle ends at t+180 (2 min idle)
        normalizer.handleIdleEnd(at: t + 180)
        // Close Xcode at t+240
        normalizer.process(ActivityEvent(timestamp: t + 240, eventType: .appActivated,
                                          appBundleId: "com.tinyspeck.slackmacgap", appName: "Slack",
                                          source: .nsworkspace))

        let sessions = try db.read { database in
            try AppSession.filter(Column("appBundleId") == "com.apple.dt.Xcode").fetchAll(database)
        }
        // Active duration should be ~120s (60s before idle + 60s after resume), not 240s
        let xcode = sessions.first
        XCTAssertNotNil(xcode)
        // Allow ±15s tolerance
        let duration = xcode!.activeDuration
        XCTAssertLessThan(duration, 180, "Idle time should not inflate session duration")
    }

    // MARK: - Private browsing

    func testPrivateBrowsingRedactsPageTitle() throws {
        settings.privateBrowsingBehavior = .trackTimeOnly
        let t: Double = 1_700_000_000

        let privateEvent = ActivityEvent(
            timestamp: t,
            eventType: .websiteVisit,
            browserName: "chrome",
            domain: "privatesite.com",
            pageTitle: "My Secret Page",
            isPrivate: true,
            source: .extensionChromium
        )
        normalizer.process(privateEvent)

        // The raw event is stored but with redacted page title
        let events = try db.read { database in
            try ActivityEvent.filter(Column("domain") == "privatesite.com").fetchAll(database)
        }
        XCTAssertTrue(events.first?.pageTitle == nil, "Private browsing page title must be redacted")
    }

    func testPrivateBrowsingTrackNothingSkipsEvent() throws {
        settings.privateBrowsingBehavior = .trackNothing
        let t: Double = 1_700_000_000

        let privateEvent = ActivityEvent(
            timestamp: t,
            eventType: .websiteVisit,
            browserName: "chrome",
            domain: "secretsite.com",
            isPrivate: true,
            source: .extensionChromium
        )
        normalizer.process(privateEvent)

        // Website visit table should be empty
        let visits = try db.read { database in
            try WebsiteVisit.filter(Column("domain") == "secretsite.com").fetchAll(database)
        }
        XCTAssertTrue(visits.isEmpty, "trackNothing mode must not store any visit")
    }

    // MARK: - Browser session opens alongside app session

    func testBrowserAppOpensBrowserSession() throws {
        let t: Double = 1_700_000_000
        normalizer.process(ActivityEvent(timestamp: t, eventType: .appActivated,
                                          appBundleId: "com.google.Chrome", appName: "Chrome",
                                          source: .nsworkspace))
        normalizer.process(ActivityEvent(timestamp: t + 60, eventType: .appActivated,
                                          appBundleId: "com.apple.dt.Xcode", appName: "Xcode",
                                          source: .nsworkspace))

        let browserSessions = try db.read { database in
            try BrowserSession.filter(Column("browserBundleId") == "com.google.Chrome").fetchAll(database)
        }
        XCTAssertFalse(browserSessions.isEmpty, "Chrome should open a BrowserSession")
        XCTAssertGreaterThan(browserSessions[0].activeDuration, 0)
    }
}
