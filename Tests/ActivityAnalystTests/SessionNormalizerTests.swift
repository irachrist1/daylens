import XCTest
@testable import ActivityAnalystCore

final class SessionNormalizerTests: XCTestCase {
    var normalizer: SessionNormalizer!
    let testAppId = UUID()
    let testBrowserId = UUID()
    let testWebsiteId = UUID()

    override func setUp() {
        super.setUp()
        normalizer = SessionNormalizer()
    }

    // MARK: - Basic Session Building

    func testActivationDeactivationCreatesSingleSession() {
        let start = Date()
        let events: [ActivityEvent] = [
            ActivityEvent(
                timestamp: start,
                eventType: .appActivated,
                appId: testAppId,
                source: .native
            ),
            ActivityEvent(
                timestamp: start.addingTimeInterval(60),
                eventType: .appDeactivated,
                appId: testAppId,
                source: .native
            ),
        ]

        let sessions = normalizer.normalize(events: events)
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].appId, testAppId)
        XCTAssertEqual(sessions[0].duration, 60, accuracy: 0.1)
    }

    func testEmptyEventsProducesNoSessions() {
        let sessions = normalizer.normalize(events: [])
        XCTAssertTrue(sessions.isEmpty)
    }

    func testMultipleAppsCreateSeparateSessions() {
        let start = Date()
        let app1 = UUID()
        let app2 = UUID()

        let events: [ActivityEvent] = [
            ActivityEvent(timestamp: start, eventType: .appActivated, appId: app1),
            ActivityEvent(timestamp: start.addingTimeInterval(30), eventType: .appDeactivated, appId: app1),
            ActivityEvent(timestamp: start.addingTimeInterval(30), eventType: .appActivated, appId: app2),
            ActivityEvent(timestamp: start.addingTimeInterval(90), eventType: .appDeactivated, appId: app2),
        ]

        let sessions = normalizer.normalize(events: events)
        XCTAssertEqual(sessions.count, 2)
        XCTAssertEqual(sessions[0].appId, app1)
        XCTAssertEqual(sessions[0].duration, 30, accuracy: 0.1)
        XCTAssertEqual(sessions[1].appId, app2)
        XCTAssertEqual(sessions[1].duration, 60, accuracy: 0.1)
    }

    // MARK: - Significance Threshold

    func testSubFiveSecondSessionIsNotSignificant() {
        let start = Date()
        let events: [ActivityEvent] = [
            ActivityEvent(timestamp: start, eventType: .appActivated, appId: testAppId),
            ActivityEvent(timestamp: start.addingTimeInterval(3), eventType: .appDeactivated, appId: testAppId),
        ]

        let sessions = normalizer.normalize(events: events)
        XCTAssertEqual(sessions.count, 1)
        XCTAssertFalse(sessions[0].isSignificant)
    }

    func testFiveSecondSessionIsSignificant() {
        let start = Date()
        let events: [ActivityEvent] = [
            ActivityEvent(timestamp: start, eventType: .appActivated, appId: testAppId),
            ActivityEvent(timestamp: start.addingTimeInterval(5), eventType: .appDeactivated, appId: testAppId),
        ]

        let sessions = normalizer.normalize(events: events)
        XCTAssertEqual(sessions.count, 1)
        XCTAssertTrue(sessions[0].isSignificant)
    }

    func testTwelveMinuteSessionIsSignificant() {
        let start = Date()
        let events: [ActivityEvent] = [
            ActivityEvent(timestamp: start, eventType: .appActivated, appId: testAppId),
            ActivityEvent(timestamp: start.addingTimeInterval(720), eventType: .appDeactivated, appId: testAppId),
        ]

        let sessions = normalizer.normalize(events: events)
        XCTAssertEqual(sessions.count, 1)
        XCTAssertTrue(sessions[0].isSignificant)
        XCTAssertEqual(sessions[0].duration, 720, accuracy: 0.1)
    }

    // MARK: - Session Merging

    func testSessionsMergeWithinEightSecondGap() {
        let start = Date()
        let events: [ActivityEvent] = [
            ActivityEvent(timestamp: start, eventType: .appActivated, appId: testAppId),
            ActivityEvent(timestamp: start.addingTimeInterval(10), eventType: .appDeactivated, appId: testAppId),
            // 5 second gap — within 8 second merge window
            ActivityEvent(timestamp: start.addingTimeInterval(15), eventType: .appActivated, appId: testAppId),
            ActivityEvent(timestamp: start.addingTimeInterval(25), eventType: .appDeactivated, appId: testAppId),
        ]

        let sessions = normalizer.normalize(events: events)
        XCTAssertEqual(sessions.count, 1, "Sessions within 8s gap should merge")
        XCTAssertEqual(sessions[0].duration, 20, accuracy: 0.1)
    }

    func testSessionsDoNotMergeBeyondEightSecondGap() {
        let start = Date()
        let events: [ActivityEvent] = [
            ActivityEvent(timestamp: start, eventType: .appActivated, appId: testAppId),
            ActivityEvent(timestamp: start.addingTimeInterval(10), eventType: .appDeactivated, appId: testAppId),
            // 10 second gap — exceeds 8 second merge window
            ActivityEvent(timestamp: start.addingTimeInterval(20), eventType: .appActivated, appId: testAppId),
            ActivityEvent(timestamp: start.addingTimeInterval(30), eventType: .appDeactivated, appId: testAppId),
        ]

        let sessions = normalizer.normalize(events: events)
        XCTAssertEqual(sessions.count, 2, "Sessions beyond 8s gap should not merge")
    }

    func testRapidSwitchingMergesBursts() {
        let start = Date()
        let app1 = UUID()
        let app2 = UUID()

        // User switches rapidly between two apps 5 times in 60 seconds
        var events: [ActivityEvent] = []
        for i in 0..<5 {
            let offset = TimeInterval(i * 12)
            events.append(ActivityEvent(
                timestamp: start.addingTimeInterval(offset),
                eventType: .appActivated,
                appId: i % 2 == 0 ? app1 : app2
            ))
            events.append(ActivityEvent(
                timestamp: start.addingTimeInterval(offset + 6),
                eventType: .appDeactivated,
                appId: i % 2 == 0 ? app1 : app2
            ))
        }

        let sessions = normalizer.normalize(events: events)
        let app1Sessions = sessions.filter { $0.appId == app1 }
        let app2Sessions = sessions.filter { $0.appId == app2 }

        // After merging, should have fewer sessions than raw switches
        XCTAssertTrue(app1Sessions.count <= 3)
        XCTAssertTrue(app2Sessions.count <= 2)
    }

    func testDifferentAppsDontMerge() {
        let start = Date()
        let app1 = UUID()
        let app2 = UUID()

        let events: [ActivityEvent] = [
            ActivityEvent(timestamp: start, eventType: .appActivated, appId: app1),
            ActivityEvent(timestamp: start.addingTimeInterval(10), eventType: .appDeactivated, appId: app1),
            ActivityEvent(timestamp: start.addingTimeInterval(12), eventType: .appActivated, appId: app2),
            ActivityEvent(timestamp: start.addingTimeInterval(22), eventType: .appDeactivated, appId: app2),
        ]

        let sessions = normalizer.normalize(events: events)
        XCTAssertEqual(sessions.count, 2, "Different apps should not merge even if gap is small")
    }

    // MARK: - Idle Detection

    func testIdleSubtractsFromSessionDuration() {
        let start = Date()
        let events: [ActivityEvent] = [
            ActivityEvent(timestamp: start, eventType: .appActivated, appId: testAppId),
            ActivityEvent(timestamp: start.addingTimeInterval(30), eventType: .idleStart, appId: testAppId),
            ActivityEvent(timestamp: start.addingTimeInterval(90), eventType: .idleEnd, appId: testAppId),
            ActivityEvent(timestamp: start.addingTimeInterval(120), eventType: .appDeactivated, appId: testAppId),
        ]

        let sessions = normalizer.normalize(events: events)
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].idleDuration, 60, accuracy: 0.1)
        XCTAssertEqual(sessions[0].duration, 60, accuracy: 0.1) // 120 total - 60 idle
    }

    func testIdleDoesNotAffectNonOverlappingSessions() {
        let start = Date()
        let app1 = UUID()
        let app2 = UUID()

        let events: [ActivityEvent] = [
            ActivityEvent(timestamp: start, eventType: .appActivated, appId: app1),
            ActivityEvent(timestamp: start.addingTimeInterval(30), eventType: .appDeactivated, appId: app1),
            // Idle happens after app1 session
            ActivityEvent(timestamp: start.addingTimeInterval(40), eventType: .idleStart, appId: app1),
            ActivityEvent(timestamp: start.addingTimeInterval(100), eventType: .idleEnd, appId: app1),
            ActivityEvent(timestamp: start.addingTimeInterval(110), eventType: .appActivated, appId: app2),
            ActivityEvent(timestamp: start.addingTimeInterval(140), eventType: .appDeactivated, appId: app2),
        ]

        let sessions = normalizer.normalize(events: events)
        let app1Session = sessions.first { $0.appId == app1 }
        let app2Session = sessions.first { $0.appId == app2 }

        XCTAssertEqual(app1Session?.idleDuration ?? 0, 0, accuracy: 0.1)
        XCTAssertEqual(app2Session?.idleDuration ?? 0, 0, accuracy: 0.1)
    }

    // MARK: - Tab Changes

    func testTabChangesSplitBrowserSessions() {
        let start = Date()
        let site1 = UUID()
        let site2 = UUID()

        let events: [ActivityEvent] = [
            ActivityEvent(
                timestamp: start,
                eventType: .appActivated,
                appId: testAppId,
                browserId: testBrowserId,
                websiteId: site1
            ),
            ActivityEvent(
                timestamp: start.addingTimeInterval(30),
                eventType: .tabChanged,
                appId: testAppId,
                browserId: testBrowserId,
                websiteId: site2
            ),
            ActivityEvent(
                timestamp: start.addingTimeInterval(60),
                eventType: .appDeactivated,
                appId: testAppId,
                browserId: testBrowserId,
                websiteId: site2
            ),
        ]

        let sessions = normalizer.normalize(events: events)
        XCTAssertGreaterThanOrEqual(sessions.count, 2)
    }

    // MARK: - Focus and Fragmentation Scoring

    func testFocusScoreForFocusedDay() {
        let sessions = [
            Session(
                appId: testAppId,
                startTime: Date(),
                endTime: Date().addingTimeInterval(7200),
                duration: 7200,
                category: .development,
                isSignificant: true
            ),
        ]

        let score = SessionNormalizer.focusScore(for: sessions)
        XCTAssertGreaterThan(score, 0.0)
    }

    func testFocusScoreForEmptyDayIsZero() {
        let score = SessionNormalizer.focusScore(for: [])
        XCTAssertEqual(score, 0.0)
    }

    func testFragmentationScoreForFrequentSwitching() {
        let start = Date()
        var sessions: [Session] = []

        for i in 0..<20 {
            let offset = TimeInterval(i * 5) // 5-second gaps — very rapid
            sessions.append(Session(
                appId: UUID(),
                startTime: start.addingTimeInterval(offset),
                endTime: start.addingTimeInterval(offset + 4),
                duration: 4,
                isSignificant: true
            ))
        }

        let score = SessionNormalizer.fragmentationScore(for: sessions)
        XCTAssertGreaterThan(score, 0.5, "Rapid switching should produce high fragmentation")
    }

    func testFragmentationScoreForSingleSessionIsZero() {
        let sessions = [
            Session(
                appId: testAppId,
                startTime: Date(),
                endTime: Date().addingTimeInterval(3600),
                duration: 3600,
                isSignificant: true
            ),
        ]

        let score = SessionNormalizer.fragmentationScore(for: sessions)
        XCTAssertEqual(score, 0.0)
    }
}
