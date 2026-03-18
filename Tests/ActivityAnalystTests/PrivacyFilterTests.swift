import XCTest
@testable import ActivityAnalystCore

final class PrivacyFilterTests: XCTestCase {
    let testAppId = UUID()

    // MARK: - URL Redaction

    func testURLQueryParametersAreStripped() {
        let filter = PrivacyFilter()
        let redacted = filter.redactURL("https://example.com/page?token=secret&user=john")
        XCTAssertEqual(redacted, "https://example.com/page")
    }

    func testURLFragmentsAreStripped() {
        let filter = PrivacyFilter()
        let redacted = filter.redactURL("https://example.com/page#section")
        XCTAssertEqual(redacted, "https://example.com/page")
    }

    func testSimpleURLIsUnchanged() {
        let filter = PrivacyFilter()
        let redacted = filter.redactURL("https://example.com/page")
        XCTAssertEqual(redacted, "https://example.com/page")
    }

    func testNilURLReturnsNil() {
        let filter = PrivacyFilter()
        XCTAssertNil(filter.redactURL(nil))
    }

    // MARK: - Window Title Redaction

    func testSensitiveWindowTitleIsRedacted() {
        let filter = PrivacyFilter()
        XCTAssertEqual(filter.redactWindowTitle("Enter your password"), "[Redacted]")
        XCTAssertEqual(filter.redactWindowTitle("API_KEY Settings"), "[Redacted]")
        XCTAssertEqual(filter.redactWindowTitle("Auth Token Manager"), "[Redacted]")
    }

    func testNormalWindowTitleIsUnchanged() {
        let filter = PrivacyFilter()
        XCTAssertEqual(filter.redactWindowTitle("Activity Analyst - GitHub"), "Activity Analyst - GitHub")
    }

    // MARK: - Private Browsing

    func testTrackNothingDropsPrivateEvents() {
        let prefs = TrackingPreferences(trackPrivateBrowsing: .trackNothing)
        let filter = PrivacyFilter(preferences: prefs)

        let event = ActivityEvent(
            eventType: .tabChanged,
            appId: testAppId,
            url: "https://private.example.com",
            pageTitle: "Secret Page",
            isPrivateBrowsing: true
        )

        XCTAssertNil(filter.filter(event))
    }

    func testCoarseBrowserOnlyStripsPrivateDetails() {
        let prefs = TrackingPreferences(trackPrivateBrowsing: .coarseBrowserOnly)
        let filter = PrivacyFilter(preferences: prefs)

        let event = ActivityEvent(
            eventType: .tabChanged,
            appId: testAppId,
            websiteId: UUID(),
            url: "https://private.example.com",
            pageTitle: "Secret Page",
            isPrivateBrowsing: true
        )

        let filtered = filter.filter(event)
        XCTAssertNotNil(filtered)
        XCTAssertNil(filtered?.url)
        XCTAssertNil(filtered?.pageTitle)
        XCTAssertNil(filtered?.windowTitle)
        XCTAssertNil(filtered?.websiteId)
    }

    func testTrackEverythingKeepsPrivateDetails() {
        let prefs = TrackingPreferences(trackPrivateBrowsing: .trackEverything)
        let filter = PrivacyFilter(preferences: prefs)

        let event = ActivityEvent(
            eventType: .tabChanged,
            appId: testAppId,
            url: "https://private.example.com",
            pageTitle: "Secret Page",
            isPrivateBrowsing: true
        )

        let filtered = filter.filter(event)
        XCTAssertNotNil(filtered)
        XCTAssertNotNil(filtered?.url)
        XCTAssertNotNil(filtered?.pageTitle)
    }

    func testNonPrivateEventsPassThrough() {
        let filter = PrivacyFilter()

        let event = ActivityEvent(
            eventType: .appActivated,
            appId: testAppId,
            isPrivateBrowsing: false
        )

        XCTAssertNotNil(filter.filter(event))
    }

    // MARK: - Tracking Pause

    func testPausedTrackingDropsAllEvents() {
        let prefs = TrackingPreferences(pauseTracking: true)
        let filter = PrivacyFilter(preferences: prefs)

        let event = ActivityEvent(
            eventType: .appActivated,
            appId: testAppId
        )

        XCTAssertNil(filter.filter(event))
    }
}
