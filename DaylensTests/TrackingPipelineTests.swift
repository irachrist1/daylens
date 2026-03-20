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
}
