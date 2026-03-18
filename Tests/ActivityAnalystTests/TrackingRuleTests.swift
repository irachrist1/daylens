import XCTest
@testable import ActivityAnalystCore

final class TrackingRuleTests: XCTestCase {

    // MARK: - Default Rule Values

    func testDefaultMinimumAppUseDuration() {
        XCTAssertEqual(TrackingRules.minimumAppUseDuration, 5.0)
    }

    func testDefaultMinimumWebVisitDuration() {
        XCTAssertEqual(TrackingRules.minimumWebVisitDuration, 5.0)
    }

    func testDefaultSessionMergeWindow() {
        XCTAssertEqual(TrackingRules.sessionMergeWindow, 8.0)
    }

    func testDefaultIdleGracePeriod() {
        XCTAssertEqual(TrackingRules.idleGracePeriod, 120.0)
    }

    func testDefaultRetentionDays() {
        XCTAssertEqual(TrackingRules.defaultRetentionDays, 90)
    }

    // MARK: - Tracking Preferences

    func testPreferencesOverrideDefaults() {
        let prefs = TrackingPreferences(
            minimumAppUseDuration: 10.0,
            sessionMergeWindow: 15.0,
            retentionDays: 365
        )

        XCTAssertEqual(prefs.effectiveMinAppUse, 10.0)
        XCTAssertEqual(prefs.effectiveMergeWindow, 15.0)
        XCTAssertEqual(prefs.effectiveRetentionDays, 365)
    }

    func testPreferencesUseDefaultsWhenNil() {
        let prefs = TrackingPreferences()

        XCTAssertEqual(prefs.effectiveMinAppUse, TrackingRules.minimumAppUseDuration)
        XCTAssertEqual(prefs.effectiveMinWebVisit, TrackingRules.minimumWebVisitDuration)
        XCTAssertEqual(prefs.effectiveMergeWindow, TrackingRules.sessionMergeWindow)
        XCTAssertEqual(prefs.effectiveIdleGrace, TrackingRules.idleGracePeriod)
        XCTAssertEqual(prefs.effectiveRetentionDays, TrackingRules.defaultRetentionDays)
    }

    func testDefaultPrivateBrowsingMode() {
        let prefs = TrackingPreferences()
        XCTAssertEqual(prefs.trackPrivateBrowsing, .coarseBrowserOnly)
    }

    func testDefaultPauseState() {
        let prefs = TrackingPreferences()
        XCTAssertFalse(prefs.pauseTracking)
    }

    // MARK: - Session Significance Rules

    func testSessionSignificanceWithDefaultRules() {
        let normalizer = SessionNormalizer()

        let now = Date()
        let shortEvents: [ActivityEvent] = [
            ActivityEvent(timestamp: now, eventType: .appActivated, appId: UUID()),
            ActivityEvent(timestamp: now.addingTimeInterval(3), eventType: .appDeactivated, appId: UUID()),
        ]

        // Short events should still produce sessions, just not significant ones
        // (The normalizer stores all events but marks significance)
    }

    // MARK: - Category Classification

    func testKnownAppCategoryMapping() {
        XCTAssertEqual(AppRecord.inferCategory(for: "com.apple.Xcode"), .development)
        XCTAssertEqual(AppRecord.inferCategory(for: "com.tinyspeck.slackmacgap"), .communication)
        XCTAssertEqual(AppRecord.inferCategory(for: "com.apple.Safari"), .reference)
        XCTAssertEqual(AppRecord.inferCategory(for: "com.apple.Music"), .entertainment)
        XCTAssertEqual(AppRecord.inferCategory(for: "com.figma.Desktop"), .design)
    }

    func testUnknownAppDefaultsToUncategorized() {
        XCTAssertEqual(AppRecord.inferCategory(for: "com.unknown.app"), .uncategorized)
    }

    func testKnownDomainCategoryMapping() {
        XCTAssertEqual(WebsiteRecord.inferCategory(for: "github.com"), .development)
        XCTAssertEqual(WebsiteRecord.inferCategory(for: "youtube.com"), .entertainment)
        XCTAssertEqual(WebsiteRecord.inferCategory(for: "twitter.com"), .social)
        XCTAssertEqual(WebsiteRecord.inferCategory(for: "mail.google.com"), .communication)
    }

    func testDomainExtractionFromURL() {
        XCTAssertEqual(WebsiteRecord.extractDomain(from: "https://www.github.com/user/repo"), "github.com")
        XCTAssertEqual(WebsiteRecord.extractDomain(from: "https://youtube.com/watch?v=123"), "youtube.com")
        XCTAssertEqual(WebsiteRecord.extractDomain(from: "https://mail.google.com/inbox"), "mail.google.com")
        XCTAssertNil(WebsiteRecord.extractDomain(from: "not-a-url"))
    }

    // MARK: - Browser Detection

    func testKnownBrowserDetection() {
        XCTAssertTrue(BrowserRecord.isBrowser("com.apple.Safari"))
        XCTAssertTrue(BrowserRecord.isBrowser("com.google.Chrome"))
        XCTAssertTrue(BrowserRecord.isBrowser("company.thebrowser.Browser"))
        XCTAssertFalse(BrowserRecord.isBrowser("com.apple.Xcode"))
    }

    func testChromiumBrowserDetection() {
        XCTAssertTrue(BrowserRecord.isChromiumBrowser("com.google.Chrome"))
        XCTAssertTrue(BrowserRecord.isChromiumBrowser("com.brave.Browser"))
        XCTAssertTrue(BrowserRecord.isChromiumBrowser("company.thebrowser.Browser"))
        XCTAssertFalse(BrowserRecord.isChromiumBrowser("com.apple.Safari"))
        XCTAssertFalse(BrowserRecord.isChromiumBrowser("org.mozilla.firefox"))
    }

    // MARK: - Focus Category Classification

    func testFocusCategories() {
        XCTAssertTrue(ActivityCategory.productivity.isFocusCategory)
        XCTAssertTrue(ActivityCategory.development.isFocusCategory)
        XCTAssertTrue(ActivityCategory.writing.isFocusCategory)
        XCTAssertFalse(ActivityCategory.entertainment.isFocusCategory)
        XCTAssertFalse(ActivityCategory.social.isFocusCategory)
    }
}
