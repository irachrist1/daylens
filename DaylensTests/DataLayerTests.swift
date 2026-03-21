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

    func testSaveDailySummaryPreservesExistingAISummary() throws {
        let database = try AppDatabase.inMemory()
        let day = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_710_200_000))

        try database.saveDailySummary(
            DailySummary(
                date: day,
                totalActiveTime: 1200,
                totalIdleTime: 0,
                appCount: 2,
                browserCount: 1,
                domainCount: 1,
                sessionCount: 2,
                contextSwitches: 1,
                focusScore: 0.5,
                longestFocusStreak: 600,
                topAppBundleID: "com.apple.dt.Xcode",
                topDomain: "github.com",
                aiSummary: "Focused coding day",
                aiSummaryGeneratedAt: day.addingTimeInterval(3600)
            )
        )

        try database.saveDailySummary(
            DailySummary(
                date: day,
                totalActiveTime: 1800,
                totalIdleTime: 0,
                appCount: 3,
                browserCount: 1,
                domainCount: 2,
                sessionCount: 3,
                contextSwitches: 2,
                focusScore: 0.6,
                longestFocusStreak: 900,
                topAppBundleID: "com.apple.dt.Xcode",
                topDomain: "linear.app",
                aiSummary: nil,
                aiSummaryGeneratedAt: nil
            )
        )

        let summary = try database.dailySummary(for: day)
        XCTAssertEqual(summary?.totalActiveTime ?? 0, 1800, accuracy: 0.001)
        XCTAssertEqual(summary?.aiSummary, "Focused coding day")
        XCTAssertNotNil(summary?.aiSummaryGeneratedAt)
    }

    func testAppUsageSummariesExcludeSessionNoise() throws {
        let database = try AppDatabase.inMemory()
        let day = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_710_300_000))

        try database.insertAppSession(
            AppSession(
                date: day,
                bundleID: "com.apple.loginwindow",
                appName: "loginwindow",
                startTime: day.addingTimeInterval(60),
                endTime: day.addingTimeInterval(180),
                duration: 120,
                category: .system,
                isBrowser: false
            )
        )

        try database.insertAppSession(
            AppSession(
                date: day,
                bundleID: "com.apple.finder",
                appName: "Finder",
                startTime: day.addingTimeInterval(300),
                endTime: day.addingTimeInterval(900),
                duration: 600,
                category: .system,
                isBrowser: false
            )
        )

        let summaries = try database.appUsageSummaries(for: day)
        XCTAssertEqual(summaries.count, 1)
        XCTAssertEqual(summaries.first?.bundleID, "com.apple.finder")

        let timeline = try database.timelineEvents(for: day)
        XCTAssertEqual(timeline.count, 1)
        XCTAssertEqual(timeline.first?.bundleID, "com.apple.finder")
    }

    func testTrackedDaysSkipsNoiseOnlyDays() throws {
        let database = try AppDatabase.inMemory()
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_710_400_000))
        let previousDay = calendar.date(byAdding: .day, value: -1, to: today)!

        try database.insertAppSession(
            AppSession(
                date: today,
                bundleID: "com.apple.loginwindow",
                appName: "loginwindow",
                startTime: today.addingTimeInterval(30),
                endTime: today.addingTimeInterval(90),
                duration: 60,
                category: .system,
                isBrowser: false
            )
        )

        try database.insertAppSession(
            AppSession(
                date: previousDay,
                bundleID: "com.apple.dt.Xcode",
                appName: "Xcode",
                startTime: previousDay.addingTimeInterval(300),
                endTime: previousDay.addingTimeInterval(1500),
                duration: 1200,
                category: .development,
                isBrowser: false
            )
        )

        let trackedDays = try database.trackedDays(limit: 5)
        XCTAssertEqual(trackedDays.count, 1)
        XCTAssertEqual(trackedDays.first, previousDay)
    }

    func testWebsiteUsageSummariesPreferForegroundActiveSiteOverHistoryOverlap() throws {
        let database = try AppDatabase.inMemory()
        let day = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_710_500_000))
        let browserBundleID = "com.google.Chrome"

        try database.insertBrowserSession(
            BrowserSession(
                date: day,
                browserBundleID: browserBundleID,
                browserName: "Chrome",
                startTime: day.addingTimeInterval(0),
                endTime: day.addingTimeInterval(600),
                duration: 600
            )
        )

        try database.insertWebsiteVisit(
            WebsiteVisit(
                date: day,
                domain: "github.com",
                fullURL: "https://github.com/openai/daylens",
                pageTitle: "Daylens Repo",
                browserBundleID: browserBundleID,
                startTime: day.addingTimeInterval(0),
                endTime: day.addingTimeInterval(600),
                duration: 600,
                confidence: .high,
                source: .browserHistory
            )
        )

        try database.insertWebsiteVisit(
            WebsiteVisit(
                date: day,
                domain: "linear.app",
                fullURL: "https://linear.app/daylens",
                pageTitle: "Daylens Board",
                browserBundleID: browserBundleID,
                startTime: day.addingTimeInterval(120),
                endTime: day.addingTimeInterval(480),
                duration: 360,
                confidence: .medium,
                source: .accessibility
            )
        )

        let summaries = try database.websiteUsageSummaries(for: day)
        XCTAssertEqual(summaries.count, 2)
        XCTAssertEqual(summaries.first?.domain, "linear.app")
        XCTAssertEqual(summaries.first?.totalDuration ?? 0, 360, accuracy: 0.001)

        let github = summaries.first { $0.domain == "github.com" }
        XCTAssertEqual(github?.totalDuration ?? 0, 240, accuracy: 0.001)
    }

    func testAppUsageSummariesMergeShortSameAppGaps() throws {
        let database = try AppDatabase.inMemory()
        let day = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_710_600_000))

        try database.insertAppSession(
            AppSession(
                date: day,
                bundleID: "com.microsoft.teams2",
                appName: "Microsoft Teams",
                startTime: day.addingTimeInterval(0),
                endTime: day.addingTimeInterval(120),
                duration: 120,
                category: .meetings,
                isBrowser: false
            )
        )

        try database.insertAppSession(
            AppSession(
                date: day,
                bundleID: "com.microsoft.teams2",
                appName: "Microsoft Teams",
                startTime: day.addingTimeInterval(124),
                endTime: day.addingTimeInterval(300),
                duration: 176,
                category: .meetings,
                isBrowser: false
            )
        )

        let summaries = try database.appUsageSummaries(for: day)
        XCTAssertEqual(summaries.count, 1)
        XCTAssertEqual(summaries.first?.sessionCount, 1)
        XCTAssertEqual(summaries.first?.totalDuration ?? 0, 300, accuracy: 0.001)

        let timeline = try database.timelineEvents(for: day)
        XCTAssertEqual(timeline.count, 1)
        XCTAssertEqual(timeline.first?.duration ?? 0, 300, accuracy: 0.001)
    }

    func testFocusSessionsPersistAndReload() throws {
        let database = try AppDatabase.inMemory()
        let day = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_710_700_000))

        var session = FocusSessionRecord(
            date: day,
            startTime: day.addingTimeInterval(600),
            endTime: nil,
            targetMinutes: 25,
            actualDuration: 0,
            status: .running
        )
        try database.insertFocusSession(&session)

        session.endTime = day.addingTimeInterval(2100)
        session.actualDuration = 1500
        session.status = .completed
        try database.saveFocusSession(session)

        let sessions = try database.recentFocusSessions(limit: 5)
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions.first?.status, .completed)
        XCTAssertEqual(sessions.first?.actualDuration ?? 0, 1500, accuracy: 0.001)
    }
}
