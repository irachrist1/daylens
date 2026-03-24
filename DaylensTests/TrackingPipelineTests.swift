import XCTest

#if canImport(Daylens)
@testable import Daylens
#else
@testable import DaylensCore
#endif

final class TrackingPipelineTests: XCTestCase {

    func testFrontmostAppSwitchPersistsPreviousSession() throws {
        let database = try AppDatabase.inMemory()
        let tracker = ActivityTracker(database: database)
        let start = Date(timeIntervalSince1970: 1_710_000_000)

        tracker.simulateFrontmostAppChange(
            bundleID: "com.example.AppA",
            appName: "App A",
            at: start
        )

        tracker.simulateFrontmostAppChange(
            bundleID: "com.example.AppB",
            appName: "App B",
            at: start.addingTimeInterval(4)
        )

        let sessions = try database.timelineEvents(for: start)
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].appName, "App A")
        XCTAssertEqual(sessions[0].bundleID, "com.example.AppA")
        XCTAssertEqual(sessions[0].duration, 4, accuracy: 0.001)
    }

    func testDuplicateSameAppActivationDoesNotSplitSession() throws {
        let database = try AppDatabase.inMemory()
        let tracker = ActivityTracker(database: database)
        let start = Date(timeIntervalSince1970: 1_710_100_000)

        tracker.simulateFrontmostAppChange(
            bundleID: "com.microsoft.teams2",
            appName: "Microsoft Teams",
            at: start
        )

        tracker.simulateFrontmostAppChange(
            bundleID: "com.microsoft.teams2",
            appName: "Microsoft Teams",
            at: start.addingTimeInterval(5)
        )

        tracker.simulateFrontmostAppChange(
            bundleID: "com.apple.dt.Xcode",
            appName: "Xcode",
            at: start.addingTimeInterval(120)
        )

        let sessions = try database.timelineEvents(for: start)
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].bundleID, "com.microsoft.teams2")
        XCTAssertEqual(sessions[0].duration, 120, accuracy: 0.001)
    }

    func testIdlePauseResumesWithLatestFrontmostApp() throws {
        let database = try AppDatabase.inMemory()
        let tracker = ActivityTracker(database: database)
        tracker.simulateTrackingStarted()

        let firstStart = Date().addingTimeInterval(-10)
        tracker.simulateFrontmostAppChange(
            bundleID: "com.example.Video",
            appName: "Video",
            at: firstStart
        )

        tracker.pauseForIdle()
        tracker.simulateFrontmostAppChange(
            bundleID: "com.example.Chat",
            appName: "Chat",
            at: Date()
        )
        tracker.resumeFromIdle()

        tracker.simulateFrontmostAppChange(
            bundleID: "com.example.Other",
            appName: "Other",
            at: Date().addingTimeInterval(4)
        )

        let sessions = try database.timelineEvents(for: Date())
        XCTAssertEqual(sessions.count, 2)
        XCTAssertEqual(sessions.map(\.bundleID), ["com.example.Video", "com.example.Chat"])
        XCTAssertGreaterThanOrEqual(sessions[0].duration, 9)
        XCTAssertEqual(sessions[1].duration, 4, accuracy: 0.25)
    }

    func testSameAppReactivationDuringSpaceTransitionKeepsSessionContinuous() throws {
        let database = try AppDatabase.inMemory()
        let tracker = ActivityTracker(
            database: database,
            deactivationGracePeriod: 0.05,
            spaceTransitionWindow: 0.1,
            frontmostApplicationProvider: { nil }
        )
        tracker.simulateTrackingStarted()

        let start = Date().addingTimeInterval(-20)
        let deactivatedAt = Date().addingTimeInterval(-10)
        let switchedAwayAt = Date().addingTimeInterval(-1)

        tracker.simulateFrontmostAppChange(
            bundleID: "company.thebrowser.Browser",
            appName: "Arc",
            at: start
        )
        tracker.simulateActiveSpaceChange()
        tracker.simulateAppDeactivation(
            bundleID: "company.thebrowser.Browser",
            appName: "Arc",
            at: deactivatedAt
        )
        tracker.simulateFrontmostAppChange(
            bundleID: "company.thebrowser.Browser",
            appName: "Arc",
            at: deactivatedAt.addingTimeInterval(1)
        )

        RunLoop.main.run(until: Date().addingTimeInterval(0.1))

        tracker.simulateFrontmostAppChange(
            bundleID: "com.daylens.app",
            appName: "Daylens",
            at: switchedAwayAt
        )

        let sessions = try database.timelineEvents(for: Date())
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].bundleID, "company.thebrowser.Browser")
        XCTAssertEqual(sessions[0].duration, switchedAwayAt.timeIntervalSince(start), accuracy: 0.001)
    }

    func testSpaceTransitionFrontmostReconcileKeepsSessionContinuousWithoutActivationNotification() throws {
        let database = try AppDatabase.inMemory()
        var simulatedFrontmostApp: (bundleID: String, appName: String)? = (
            bundleID: "com.google.Chrome",
            appName: "Google Chrome"
        )
        let tracker = ActivityTracker(
            database: database,
            deactivationGracePeriod: 0.05,
            spaceTransitionWindow: 0.1,
            frontmostApplicationProvider: { simulatedFrontmostApp }
        )
        tracker.simulateTrackingStarted()

        let start = Date(timeIntervalSince1970: 1_710_200_000)
        let deactivatedAt = start.addingTimeInterval(10)
        let switchedAwayAt = start.addingTimeInterval(19)

        tracker.simulateFrontmostAppChange(
            bundleID: "com.google.Chrome",
            appName: "Google Chrome",
            at: start
        )
        tracker.simulateActiveSpaceChange()
        tracker.simulateAppDeactivation(
            bundleID: "com.google.Chrome",
            appName: "Google Chrome",
            at: deactivatedAt
        )

        RunLoop.main.run(until: Date().addingTimeInterval(0.1))

        simulatedFrontmostApp = (bundleID: "com.daylens.app", appName: "Daylens")
        tracker.simulateFrontmostAppChange(
            bundleID: "com.daylens.app",
            appName: "Daylens",
            at: switchedAwayAt
        )

        let sessions = try database.timelineEvents(for: start)
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].bundleID, "com.google.Chrome")
        XCTAssertEqual(sessions[0].duration, switchedAwayAt.timeIntervalSince(start), accuracy: 0.001)
    }
}
