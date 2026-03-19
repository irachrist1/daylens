import XCTest

#if canImport(Daylens)
@testable import Daylens
#else
@testable import DaylensCore
#endif

final class DataLayerTests: XCTestCase {

    func testAppSessionsRoundTripThroughInMemoryDatabase() throws {
        let database = try AppDatabase.inMemory()
        let dayStart = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_710_000_000))
        let now = dayStart.addingTimeInterval(12 * 3600)

        try database.insertAppSession(
            AppSession(
                date: dayStart,
                bundleID: "com.microsoft.VSCode",
                appName: "VS Code",
                startTime: now,
                endTime: now.addingTimeInterval(3600),
                duration: 3600,
                category: .development,
                isBrowser: false
            )
        )

        let sessions = try database.timelineEvents(for: now)
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions.first?.appName, "VS Code")
        XCTAssertEqual(sessions.first?.duration, 3600)

        try database.insertAppSession(
            AppSession(
                date: dayStart,
                bundleID: "com.google.Chrome",
                appName: "Chrome",
                startTime: now.addingTimeInterval(4000),
                endTime: now.addingTimeInterval(5800),
                duration: 1800,
                category: .browsing,
                isBrowser: true
            )
        )

        let summaries = try database.appUsageSummaries(for: now)
        XCTAssertEqual(summaries.count, 2)
        XCTAssertEqual(summaries[0].appName, "VS Code")
        XCTAssertEqual(summaries[0].totalDuration, 3600)
        XCTAssertEqual(summaries[1].appName, "Chrome")
        XCTAssertEqual(summaries[1].totalDuration, 1800)
    }

    func testAppUsageSummariesIncludeSessionsThatCrossMidnight() throws {
        let database = try AppDatabase.inMemory()
        let calendar = Calendar.current
        let selectedDay = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_710_000_000)).addingTimeInterval(86_400)
        let previousDay = calendar.date(byAdding: .day, value: -1, to: selectedDay)!
        let sessionStart = selectedDay.addingTimeInterval(-600)
        let sessionEnd = selectedDay.addingTimeInterval(900)

        try database.insertAppSession(
            AppSession(
                date: previousDay,
                bundleID: "com.google.Chrome",
                appName: "Chrome",
                startTime: sessionStart,
                endTime: sessionEnd,
                duration: sessionEnd.timeIntervalSince(sessionStart),
                category: .browsing,
                isBrowser: true
            )
        )

        let summaries = try database.appUsageSummaries(for: selectedDay)
        XCTAssertEqual(summaries.count, 1)
        XCTAssertEqual(summaries.first?.appName, "Chrome")
        XCTAssertEqual(summaries.first?.totalDuration ?? 0, 900, accuracy: 0.001)

        let timeline = try database.timelineEvents(for: selectedDay)
        XCTAssertEqual(timeline.count, 1)
        XCTAssertEqual(timeline.first?.duration ?? 0, 900, accuracy: 0.001)
        XCTAssertEqual(timeline.first?.startTime, selectedDay)
    }

    func testWebsiteVisitsForBrowserClipToSelectedDayAndMergeOverlaps() throws {
        let database = try AppDatabase.inMemory()
        let calendar = Calendar.current
        let selectedDay = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_710_000_000)).addingTimeInterval(86_400)
        let previousDay = calendar.date(byAdding: .day, value: -1, to: selectedDay)!

        try database.insertWebsiteVisit(
            WebsiteVisit(
                date: previousDay,
                domain: "github.com",
                fullURL: "https://github.com/openai",
                pageTitle: "OpenAI",
                browserBundleID: "com.google.Chrome",
                startTime: selectedDay.addingTimeInterval(-300),
                endTime: selectedDay.addingTimeInterval(900),
                duration: 1200,
                confidence: .high,
                source: .browserHistory
            )
        )

        try database.insertWebsiteVisit(
            WebsiteVisit(
                date: selectedDay,
                domain: "github.com",
                fullURL: "https://github.com/openai/daylens",
                pageTitle: "Daylens",
                browserBundleID: "com.google.Chrome",
                startTime: selectedDay.addingTimeInterval(600),
                endTime: selectedDay.addingTimeInterval(1200),
                duration: 600,
                confidence: .medium,
                source: .accessibility
            )
        )

        let summaries = try database.websiteVisitsForBrowser(
            date: selectedDay,
            browserBundleID: "com.google.Chrome",
            limit: 5
        )

        XCTAssertEqual(summaries.count, 1)
        XCTAssertEqual(summaries.first?.domain, "github.com")
        XCTAssertEqual(summaries.first?.totalDuration ?? 0, 1200, accuracy: 0.001)
    }

    func testSaveAISummaryCreatesComputedDailySummaryWhenMissing() throws {
        let database = try AppDatabase.inMemory()
        let calendar = Calendar.current
        let selectedDay = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_710_100_000))
        let sessionStart = selectedDay.addingTimeInterval(300)
        let sessionEnd = selectedDay.addingTimeInterval(900)

        try database.insertAppSession(
            AppSession(
                date: selectedDay,
                bundleID: "com.apple.dt.Xcode",
                appName: "Xcode",
                startTime: sessionStart,
                endTime: sessionEnd,
                duration: 600,
                category: .development,
                isBrowser: false
            )
        )

        try database.insertBrowserSession(
            BrowserSession(
                date: selectedDay,
                browserBundleID: "com.google.Chrome",
                browserName: "Chrome",
                startTime: sessionStart,
                endTime: sessionEnd,
                duration: 600
            )
        )

        try database.insertWebsiteVisit(
            WebsiteVisit(
                date: selectedDay,
                domain: "github.com",
                fullURL: "https://github.com/openai/daylens",
                pageTitle: "Daylens",
                browserBundleID: "com.google.Chrome",
                startTime: sessionStart,
                endTime: sessionStart.addingTimeInterval(300),
                duration: 300,
                confidence: .high,
                source: .browserHistory
            )
        )

        try database.saveAISummary("Solid focus day", for: selectedDay)

        let summary = try database.dailySummary(for: selectedDay)
        XCTAssertNotNil(summary)
        XCTAssertEqual(summary?.aiSummary, "Solid focus day")
        XCTAssertEqual(summary?.totalActiveTime ?? 0, 600, accuracy: 0.001)
        XCTAssertEqual(summary?.appCount, 1)
        XCTAssertEqual(summary?.browserCount, 1)
        XCTAssertEqual(summary?.domainCount, 1)
        XCTAssertEqual(summary?.sessionCount, 1)
        XCTAssertEqual(summary?.contextSwitches, 0)
        XCTAssertEqual(summary?.topAppBundleID, "com.apple.dt.Xcode")
        XCTAssertEqual(summary?.topDomain, "github.com")
    }
}
