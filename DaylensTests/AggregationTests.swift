import XCTest
@testable import Daylens

final class AggregationTests: XCTestCase {

    func testAppCategorization() {
        XCTAssertEqual(AppCategory.categorize(bundleID: "com.apple.dt.Xcode"), .development)
        XCTAssertEqual(AppCategory.categorize(bundleID: "com.google.Chrome"), .browser)
        XCTAssertEqual(AppCategory.categorize(bundleID: "com.tinyspeck.slackmacgap"), .communication)
        XCTAssertEqual(AppCategory.categorize(bundleID: "com.unknown.app"), .other)
    }

    func testCategoryFocusClassification() {
        XCTAssertTrue(AppCategory.productivity.isFocused)
        XCTAssertTrue(AppCategory.development.isFocused)
        XCTAssertTrue(AppCategory.design.isFocused)
        XCTAssertFalse(AppCategory.entertainment.isFocused)
        XCTAssertFalse(AppCategory.communication.isFocused)
        XCTAssertFalse(AppCategory.browser.isFocused)
    }

    func testDailySummaryFocusLabel() {
        let labels: [(score: Double, expected: String)] = [
            (0.9, "Deep Focus"),
            (0.7, "Focused"),
            (0.5, "Mixed"),
            (0.3, "Scattered"),
            (0.1, "Fragmented"),
        ]

        for test in labels {
            let summary = DailySummary(
                date: Date(), totalActiveTime: 0, totalIdleTime: 0,
                appCount: 0, browserCount: 0, domainCount: 0,
                sessionCount: 0, contextSwitches: 0,
                focusScore: test.score, longestFocusStreak: 0
            )
            XCTAssertEqual(summary.focusScoreLabel, test.expected, "Score \(test.score) should be '\(test.expected)'")
        }
    }

    func testFormattedDuration() {
        let summary = AppUsageSummary(
            bundleID: "test",
            appName: "Test",
            totalDuration: 7500, // 2h 5m
            sessionCount: 1,
            category: .other,
            isBrowser: false
        )
        XCTAssertEqual(summary.formattedDuration, "2h 5m")

        let shortSummary = AppUsageSummary(
            bundleID: "test",
            appName: "Test",
            totalDuration: 300, // 5m
            sessionCount: 1,
            category: .other,
            isBrowser: false
        )
        XCTAssertEqual(shortSummary.formattedDuration, "5m")
    }
}
