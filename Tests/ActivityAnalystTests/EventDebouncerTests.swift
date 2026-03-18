import XCTest
@testable import ActivityAnalystCore

final class EventDebouncerTests: XCTestCase {
    var debouncer: EventDebouncer!
    let testAppId = UUID()

    override func setUp() {
        super.setUp()
        debouncer = EventDebouncer(debounceWindow: 2.0)
    }

    func testFirstEventPassesThrough() {
        let event = ActivityEvent(
            timestamp: Date(),
            eventType: .appActivated,
            appId: testAppId
        )

        let result = debouncer.process(event)
        XCTAssertNotNil(result)
    }

    func testDuplicateEventWithinWindowIsDebounced() {
        let now = Date()

        let event1 = ActivityEvent(
            timestamp: now,
            eventType: .appActivated,
            appId: testAppId
        )
        let event2 = ActivityEvent(
            timestamp: now.addingTimeInterval(1.0),
            eventType: .appActivated,
            appId: testAppId
        )

        _ = debouncer.process(event1)
        let result = debouncer.process(event2)
        XCTAssertNil(result, "Duplicate event within 2s window should be debounced")
    }

    func testEventAfterWindowPasses() {
        let now = Date()

        let event1 = ActivityEvent(
            timestamp: now,
            eventType: .appActivated,
            appId: testAppId
        )
        let event2 = ActivityEvent(
            timestamp: now.addingTimeInterval(3.0),
            eventType: .appActivated,
            appId: testAppId
        )

        _ = debouncer.process(event1)
        let result = debouncer.process(event2)
        XCTAssertNotNil(result, "Event after debounce window should pass")
    }

    func testDifferentAppsAreNotDebounced() {
        let now = Date()
        let app1 = UUID()
        let app2 = UUID()

        let event1 = ActivityEvent(timestamp: now, eventType: .appActivated, appId: app1)
        let event2 = ActivityEvent(timestamp: now.addingTimeInterval(0.5), eventType: .appActivated, appId: app2)

        _ = debouncer.process(event1)
        let result = debouncer.process(event2)
        XCTAssertNotNil(result, "Different apps should not debounce each other")
    }

    func testDifferentEventTypesAreNotDebounced() {
        let now = Date()

        let event1 = ActivityEvent(timestamp: now, eventType: .appActivated, appId: testAppId)
        let event2 = ActivityEvent(timestamp: now.addingTimeInterval(0.5), eventType: .appDeactivated, appId: testAppId)

        _ = debouncer.process(event1)
        let result = debouncer.process(event2)
        XCTAssertNotNil(result, "Different event types should not debounce each other")
    }

    func testBatchProcessingFiltersCorrectly() {
        let now = Date()

        let events = [
            ActivityEvent(timestamp: now, eventType: .appActivated, appId: testAppId),
            ActivityEvent(timestamp: now.addingTimeInterval(0.5), eventType: .appActivated, appId: testAppId),
            ActivityEvent(timestamp: now.addingTimeInterval(1.0), eventType: .appActivated, appId: testAppId),
            ActivityEvent(timestamp: now.addingTimeInterval(3.0), eventType: .appActivated, appId: testAppId),
        ]

        let result = debouncer.processBatch(events)
        XCTAssertEqual(result.count, 2, "Should pass first and last (after window)")
    }

    func testResetClearsState() {
        let now = Date()

        let event1 = ActivityEvent(timestamp: now, eventType: .appActivated, appId: testAppId)
        _ = debouncer.process(event1)

        debouncer.reset()

        let event2 = ActivityEvent(
            timestamp: now.addingTimeInterval(0.5),
            eventType: .appActivated,
            appId: testAppId
        )
        let result = debouncer.process(event2)
        XCTAssertNotNil(result, "After reset, event should pass even within old window")
    }
}
