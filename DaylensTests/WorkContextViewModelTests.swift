import XCTest

#if canImport(Daylens)
@testable import Daylens
#else
@testable import DaylensCore
#endif

final class WorkContextViewModelTests: XCTestCase {
    private let calendar = Calendar.current

    func testTodayLoadPopulatesWorkBlocksWhenSessionsExist() async throws {
        let database = try AppDatabase.inMemory()
        let day = calendar.startOfDay(for: Date())

        try seed(database: database, day: day, sessions: [
            makeSession(day: day, bundleID: "com.apple.dt.Xcode", appName: "Xcode", startMinute: 9 * 60, durationMinutes: 50, category: .development),
            makeSession(day: day, bundleID: "com.google.Chrome", appName: "Chrome", startMinute: 9 * 60 + 50, durationMinutes: 5, category: .browsing, isBrowser: true),
            makeSession(day: day, bundleID: "com.apple.dt.Xcode", appName: "Xcode", startMinute: 9 * 60 + 55, durationMinutes: 35, category: .development),
        ])

        let viewModel = TodayViewModel(database: database)
        viewModel.load(for: day)
        await waitUntil("TodayViewModel load completes") { !viewModel.isLoading }

        XCTAssertFalse(viewModel.workBlocks.isEmpty)
    }

    func testTodayLoadLeavesWorkBlocksEmptyWhenNoSessionsExist() async throws {
        let database = try AppDatabase.inMemory()
        let day = calendar.startOfDay(for: Date())

        let viewModel = TodayViewModel(database: database)
        viewModel.load(for: day)
        await waitUntil("TodayViewModel empty load completes") { !viewModel.isLoading }

        XCTAssertTrue(viewModel.workBlocks.isEmpty)
    }

    func testInjectLiveSessionMarksLastBlockLive() async throws {
        let database = try AppDatabase.inMemory()
        let day = calendar.startOfDay(for: Date())
        let viewModel = TodayViewModel(database: database)

        viewModel.load(for: day)
        await waitUntil("TodayViewModel initial load completes") { !viewModel.isLoading }

        viewModel.injectLiveSession(
            bundleID: "com.microsoft.VSCode",
            appName: "VS Code",
            startedAt: Date().addingTimeInterval(-180)
        )

        await waitUntil("TodayViewModel live block recompute completes") { !viewModel.workBlocks.isEmpty }

        XCTAssertEqual(viewModel.workBlocks.count, 1)
        XCTAssertEqual(viewModel.workBlocks.last?.isLive, true)
    }

    func testTodayBlocksAggregateMultipleSessions() async throws {
        let database = try AppDatabase.inMemory()
        let day = calendar.startOfDay(for: Date())

        try seed(database: database, day: day, sessions: [
            makeSession(day: day, bundleID: "com.microsoft.VSCode", appName: "VS Code", startMinute: 9 * 60, durationMinutes: 4, category: .development),
            makeSession(day: day, bundleID: "com.google.Chrome", appName: "Chrome", startMinute: 9 * 60 + 4, durationMinutes: 4, category: .browsing, isBrowser: true),
            makeSession(day: day, bundleID: "com.microsoft.VSCode", appName: "VS Code", startMinute: 9 * 60 + 8, durationMinutes: 4, category: .development),
            makeSession(day: day, bundleID: "com.google.Chrome", appName: "Chrome", startMinute: 9 * 60 + 12, durationMinutes: 4, category: .browsing, isBrowser: true),
            makeSession(day: day, bundleID: "com.microsoft.VSCode", appName: "VS Code", startMinute: 9 * 60 + 16, durationMinutes: 4, category: .development),
        ])

        let viewModel = TodayViewModel(database: database)
        viewModel.load(for: day)
        await waitUntil("TodayViewModel aggregation load completes") { !viewModel.isLoading }

        XCTAssertLessThan(viewModel.workBlocks.count, viewModel.timeline.count)
    }

    func testHistoryLoadDetailPopulatesWorkBlocks() async throws {
        let database = try AppDatabase.inMemory()
        let day = calendar.startOfDay(for: Date()).addingTimeInterval(-86_400)

        try seed(database: database, day: day, sessions: [
            makeSession(day: day, bundleID: "com.apple.TextEdit", appName: "TextEdit", startMinute: 10 * 60, durationMinutes: 60, category: .writing),
            makeSession(day: day, bundleID: "us.zoom.xos", appName: "Zoom", startMinute: 11 * 60, durationMinutes: 45, category: .meetings),
        ])

        let viewModel = HistoryViewModel(database: database)
        viewModel.loadDetail(for: day)
        await waitUntil("HistoryViewModel detail load completes") { !viewModel.isLoadingDetail }

        XCTAssertFalse(viewModel.workBlocks.isEmpty)
        XCTAssertTrue(viewModel.workBlocks.allSatisfy { !$0.isLive })
    }

    private func seed(database: AppDatabase, day: Date, sessions: [AppSession]) throws {
        for session in sessions {
            try database.insertAppSession(session)
        }

        if sessions.contains(where: \.isBrowser) {
            let browserSession = BrowserSession(
                date: day,
                browserBundleID: "com.google.Chrome",
                browserName: "Chrome",
                startTime: day.addingTimeInterval(9 * 3600),
                endTime: day.addingTimeInterval(10 * 3600),
                duration: 3600
            )
            try database.insertBrowserSession(browserSession)
        }
    }

    private func makeSession(
        day: Date,
        bundleID: String,
        appName: String,
        startMinute: Int,
        durationMinutes: Int,
        category: AppCategory,
        isBrowser: Bool = false
    ) -> AppSession {
        let startTime = day.addingTimeInterval(TimeInterval(startMinute * 60))
        let endTime = startTime.addingTimeInterval(TimeInterval(durationMinutes * 60))
        return AppSession(
            date: day,
            bundleID: bundleID,
            appName: appName,
            startTime: startTime,
            endTime: endTime,
            duration: endTime.timeIntervalSince(startTime),
            category: category,
            isBrowser: isBrowser
        )
    }

    private func waitUntil(
        _ description: String,
        timeout: TimeInterval = 2,
        condition: @escaping () -> Bool
    ) async {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }

        XCTFail("Timed out waiting for \(description)")
    }
}
