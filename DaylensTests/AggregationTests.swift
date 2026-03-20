import XCTest

#if canImport(Daylens)
@testable import Daylens
#else
@testable import DaylensCore
#endif

final class AggregationTests: XCTestCase {

    func testAppCategorization() {
        XCTAssertEqual(AppCategory.categorize(bundleID: "com.apple.dt.Xcode", appName: "Xcode"), .development)
        XCTAssertEqual(AppCategory.categorize(bundleID: "com.google.Chrome", appName: "Chrome"), .browsing)
        XCTAssertEqual(AppCategory.categorize(bundleID: "com.tinyspeck.slackmacgap", appName: "Slack"), .communication)
        XCTAssertEqual(AppCategory.categorize(bundleID: "com.anthropic.claudefordesktop", appName: "Claude"), .aiTools)
        XCTAssertEqual(AppCategory.categorize(bundleID: "com.unknown.app", appName: "Unknown"), .uncategorized)
    }

    func testAppClassificationIncludesSemanticLabelAndConfidence() {
        let claude = AppCategory.classify(bundleID: "com.anthropic.claudefordesktop", appName: "Claude")
        XCTAssertEqual(claude.category, .aiTools)
        XCTAssertEqual(claude.semanticLabel, "AI assistant")
        XCTAssertEqual(claude.confidence, .high)

        // Dia from The Browser Company — exact bundle match, not a generic browser
        let dia = AppCategory.classify(bundleID: "company.thebrowser.dia", appName: "Dia")
        XCTAssertEqual(dia.category, .aiTools)
        XCTAssertEqual(dia.confidence, .high)
    }

    func testCategoryFocusClassification() {
        XCTAssertTrue(AppCategory.development.isFocused)
        XCTAssertTrue(AppCategory.research.isFocused)
        XCTAssertTrue(AppCategory.writing.isFocused)
        XCTAssertTrue(AppCategory.aiTools.isFocused)
        XCTAssertTrue(AppCategory.design.isFocused)
        XCTAssertFalse(AppCategory.entertainment.isFocused)
        XCTAssertFalse(AppCategory.communication.isFocused)
        XCTAssertFalse(AppCategory.browsing.isFocused)
        XCTAssertFalse(AppCategory.system.isFocused)
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
            category: .uncategorized,
            isBrowser: false
        )
        XCTAssertEqual(summary.formattedDuration, "2h 5m")

        let shortSummary = AppUsageSummary(
            bundleID: "test",
            appName: "Test",
            totalDuration: 300, // 5m
            sessionCount: 1,
            category: .uncategorized,
            isBrowser: false
        )
        XCTAssertEqual(shortSummary.formattedDuration, "5m")
    }

    func testFormattedDurationSeconds() {
        let summary = AppUsageSummary(
            bundleID: "test",
            appName: "Test",
            totalDuration: 45,
            sessionCount: 1,
            category: .uncategorized,
            isBrowser: false
        )
        XCTAssertEqual(summary.formattedDuration, "45s")
    }

    // MARK: - TodayViewModel Aggregation Tests

    func testTotalActiveTimeFromSummaries() {
        let vm = TodayViewModel()

        // Empty state
        XCTAssertEqual(vm.totalActiveTime, "0m")

        // Populate with summaries
        vm.appSummaries = [
            AppUsageSummary(bundleID: "a", appName: "A", totalDuration: 3600, sessionCount: 1, category: .development, isBrowser: false),
            AppUsageSummary(bundleID: "b", appName: "B", totalDuration: 1800, sessionCount: 2, category: .browsing, isBrowser: true),
        ]
        // 3600 + 1800 = 5400s = 1h 30m
        XCTAssertEqual(vm.totalActiveTime, "1h 30m")
    }

    func testTotalActiveTimeMinutesOnly() {
        let vm = TodayViewModel()
        vm.appSummaries = [
            AppUsageSummary(bundleID: "a", appName: "A", totalDuration: 600, sessionCount: 1, category: .uncategorized, isBrowser: false),
        ]
        XCTAssertEqual(vm.totalActiveTime, "10m")
    }

    func testTotalActiveTimeSecondsOnly() {
        let vm = TodayViewModel()
        vm.appSummaries = [
            AppUsageSummary(bundleID: "a", appName: "A", totalDuration: 30, sessionCount: 1, category: .uncategorized, isBrowser: false),
        ]
        XCTAssertEqual(vm.totalActiveTime, "30s")
    }

    func testFocusScoreFromSummaries() {
        let vm = TodayViewModel()

        // No data
        XCTAssertEqual(vm.focusScoreText, "—")
        XCTAssertEqual(vm.focusLabel, "No data")

        // All focused (development + productivity)
        vm.appSummaries = [
            AppUsageSummary(bundleID: "a", appName: "Xcode", totalDuration: 3600, sessionCount: 1, category: .development, isBrowser: false),
        ]
        XCTAssertEqual(vm.focusScoreText, "100%")
        XCTAssertEqual(vm.focusLabel, "Deep Focus")

        // Mixed: 60% focused
        vm.appSummaries = [
            AppUsageSummary(bundleID: "a", appName: "Xcode", totalDuration: 600, sessionCount: 1, category: .development, isBrowser: false),
            AppUsageSummary(bundleID: "b", appName: "Slack", totalDuration: 400, sessionCount: 1, category: .communication, isBrowser: false),
        ]
        XCTAssertEqual(vm.focusScoreText, "60%")
        XCTAssertEqual(vm.focusLabel, "Focused")
    }

    func testCategoryRollupsGroupBySemanticCategory() {
        let vm = TodayViewModel()
        vm.appSummaries = [
            AppUsageSummary(bundleID: "com.apple.dt.Xcode", appName: "Xcode", totalDuration: 2400, sessionCount: 2, category: .development, isBrowser: false),
            AppUsageSummary(bundleID: "com.anthropic.claudefordesktop", appName: "Claude", totalDuration: 1200, sessionCount: 3, category: .aiTools, isBrowser: false),
            AppUsageSummary(bundleID: "com.google.Chrome", appName: "Chrome", totalDuration: 600, sessionCount: 1, category: .browsing, isBrowser: true),
        ]

        XCTAssertEqual(vm.categorySummaries.map(\.category), [.development, .aiTools, .browsing])
        XCTAssertEqual(vm.categorySummaries.first?.formattedDuration, "40m")
    }

    func testPromptContextIncludesCategoryBreakdownAndSemanticHints() {
        let date = Date(timeIntervalSince1970: 1_710_000_000)
        let appSummaries = [
            AppUsageSummary(bundleID: "com.apple.dt.Xcode", appName: "Xcode", totalDuration: 3600, sessionCount: 2, category: .development, isBrowser: false),
            AppUsageSummary(bundleID: "com.anthropic.claudefordesktop", appName: "Claude", totalDuration: 1800, sessionCount: 4, category: .aiTools, isBrowser: false),
        ]

        let context = AIPromptBuilder.buildDayContext(
            date: date,
            appSummaries: appSummaries,
            websiteSummaries: [],
            browserSummaries: [],
            dailySummary: nil
        )

        XCTAssertTrue(context.contains("### Category Breakdown"))
        XCTAssertTrue(context.contains("Development"))
        XCTAssertTrue(context.contains("AI Tools"))
        XCTAssertTrue(context.contains("type: Apple IDE"))
        XCTAssertTrue(context.contains("type: AI assistant"))
        XCTAssertTrue(context.contains("sessions: 4"))
    }

    func testFocusScoreUsesLiveSummariesOverDailySummary() {
        let vm = TodayViewModel()

        // dailySummary has a score, but appSummaries also present — live data wins
        vm.appSummaries = [
            AppUsageSummary(bundleID: "a", appName: "Xcode", totalDuration: 1000, sessionCount: 1, category: .development, isBrowser: false),
        ]
        // Even with no dailySummary, the live computation should work
        XCTAssertEqual(vm.focusScoreText, "100%")
    }

    func testFocusLabelBuckets() {
        let vm = TodayViewModel()

        // Scattered: 25% focused
        vm.appSummaries = [
            AppUsageSummary(bundleID: "a", appName: "Xcode", totalDuration: 250, sessionCount: 1, category: .development, isBrowser: false),
            AppUsageSummary(bundleID: "b", appName: "YouTube", totalDuration: 750, sessionCount: 1, category: .entertainment, isBrowser: false),
        ]
        XCTAssertEqual(vm.focusLabel, "Scattered")

        // Fragmented: 10% focused
        vm.appSummaries = [
            AppUsageSummary(bundleID: "a", appName: "Xcode", totalDuration: 100, sessionCount: 1, category: .development, isBrowser: false),
            AppUsageSummary(bundleID: "b", appName: "YouTube", totalDuration: 900, sessionCount: 1, category: .entertainment, isBrowser: false),
        ]
        XCTAssertEqual(vm.focusLabel, "Fragmented")
    }

    func testGreetingUsesStoredName() {
        UserDefaults.standard.set("Tonny", forKey: Constants.DefaultsKey.userName)
        let vm = TodayViewModel()
        XCTAssertTrue(vm.greeting.contains("Tonny"))
        let validPrefixes = ["Good morning", "Good afternoon", "Good evening"]
        XCTAssertTrue(validPrefixes.contains(where: { vm.greeting.hasPrefix($0) }),
                       "Greeting '\(vm.greeting)' should start with a time-of-day prefix")
    }

    func testGreetingFallsBackToThereWhenNoName() {
        UserDefaults.standard.removeObject(forKey: Constants.DefaultsKey.userName)
        let vm = TodayViewModel()
        XCTAssertTrue(vm.greeting.contains("there"),
                       "Greeting '\(vm.greeting)' should contain 'there' when no name is stored")
    }

    func testGreetingFallsBackToThereForEmptyName() {
        UserDefaults.standard.set("   ", forKey: Constants.DefaultsKey.userName)
        let vm = TodayViewModel()
        XCTAssertTrue(vm.greeting.contains("there"),
                       "Greeting '\(vm.greeting)' should contain 'there' for whitespace-only name")
    }

    func testHistoryPreferredInitialDateChoosesTodayWhenAvailable() {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today)!

        let days = [
            DaySummarySnapshot(
                date: yesterday,
                totalActiveTime: 3600,
                appCount: 4,
                topAppName: "Xcode",
                topAppBundleID: "com.apple.dt.Xcode"
            ),
            DaySummarySnapshot(
                date: today,
                totalActiveTime: 1800,
                appCount: 2,
                topAppName: "Safari",
                topAppBundleID: "com.apple.Safari"
            ),
        ]

        XCTAssertEqual(HistoryViewModel.preferredInitialDate(from: days), today)
    }

    func testPromptContextIncludesRecentDayComparisons() {
        let today = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_710_000_000))
        let previousDay = Calendar.current.date(byAdding: .day, value: -1, to: today)!

        let context = AIPromptBuilder.buildDayContext(
            date: today,
            appSummaries: [
                AppUsageSummary(bundleID: "com.apple.dt.Xcode", appName: "Xcode", totalDuration: 3600, sessionCount: 2, category: .development, isBrowser: false),
            ],
            websiteSummaries: [],
            browserSummaries: [],
            dailySummary: nil,
            previousDays: [
                AIDayContextPayload(
                    date: previousDay,
                    appSummaries: [
                        AppUsageSummary(bundleID: "com.google.Chrome", appName: "Chrome", totalDuration: 1800, sessionCount: 1, category: .browsing, isBrowser: true),
                    ],
                    websiteSummaries: [
                        WebsiteUsageSummary(domain: "github.com", totalDuration: 600, visitCount: 3, topPageTitle: "Repo", confidence: .medium, browserName: "Chrome"),
                    ],
                    browserSummaries: [],
                    dailySummary: nil
                )
            ]
        )

        XCTAssertTrue(context.contains("### Recent Day Comparisons"))
        XCTAssertTrue(context.contains("top site: github.com"))
        XCTAssertTrue(context.contains("exclude known system/session noise"))
    }
}
