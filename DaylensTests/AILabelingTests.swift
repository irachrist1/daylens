import XCTest

#if canImport(Daylens)
@testable import Daylens
#else
@testable import DaylensCore
#endif

final class AILabelingTests: XCTestCase {
    private let calendar = Calendar.current
    private var defaultsSuiteName = ""
    private var testDefaults: UserDefaults!
    private var blockLabelCache: BlockLabelCache!

    override func setUp() {
        super.setUp()
        defaultsSuiteName = "AILabelingTests.\(UUID().uuidString)"
        testDefaults = UserDefaults(suiteName: defaultsSuiteName)
        testDefaults.removePersistentDomain(forName: defaultsSuiteName)
        blockLabelCache = BlockLabelCache(defaults: testDefaults, calendar: calendar)
    }

    override func tearDown() {
        testDefaults.removePersistentDomain(forName: defaultsSuiteName)
        testDefaults = nil
        blockLabelCache = nil
        super.tearDown()
    }

    func testBlockLabelPromptProducesGroundedPrompt() {
        let prompt = AIPromptBuilder.blockLabelPrompt(
            dominantCategory: .development,
            appNames: ["Xcode", "Safari"],
            domains: ["github.com", "stripe.com"],
            windowTitles: ["CheckoutService.swift", "PR #42"],
            durationMinutes: 52
        )

        XCTAssertFalse(prompt.isEmpty)
        XCTAssertTrue(prompt.contains("3-7 word title-case label"))
        XCTAssertTrue(prompt.contains("Xcode"))
        XCTAssertTrue(prompt.contains("github.com"))
        XCTAssertTrue(prompt.contains("CheckoutService.swift"))
    }

    func testBlockLabelCacheRoundTripsSavedLabel() {
        let day = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_710_000_000))
        let block = makeBlock(day: day)

        blockLabelCache.saveCachedLabel("Building Checkout Flow", for: block, date: day)

        XCTAssertEqual(
            blockLabelCache.loadCachedLabel(for: block, date: day),
            "Building Checkout Flow"
        )
    }

    func testBlockLabelCacheReturnsNilWhenMissing() {
        let day = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_710_000_000))

        XCTAssertNil(blockLabelCache.loadCachedLabel(for: makeBlock(day: day), date: day))
    }

    func testTodayViewModelAppliesCachedBlockLabel() async throws {
        let database = try AppDatabase.inMemory()
        let day = calendar.startOfDay(for: Date())
        let sessions = [
            makeSession(
                day: day,
                bundleID: "com.apple.dt.Xcode",
                appName: "Xcode",
                startMinute: 9 * 60,
                durationMinutes: 45,
                category: .development
            ),
            makeSession(
                day: day,
                bundleID: "com.google.Chrome",
                appName: "Chrome",
                startMinute: 9 * 60 + 45,
                durationMinutes: 10,
                category: .browsing,
                isBrowser: true
            ),
        ]

        try seed(database: database, day: day, sessions: sessions)

        let expectedBlock = WorkContextGrouper.group(sessions: sessions, websiteSummaries: []).first!
        blockLabelCache.saveCachedLabel("Building Checkout Flow", for: expectedBlock, date: day)

        let viewModel = TodayViewModel(database: database, blockLabelCache: blockLabelCache)
        viewModel.load(for: day)
        await waitUntil("TodayViewModel cached label load completes") { !viewModel.isLoading }

        XCTAssertEqual(viewModel.workBlocks.first?.displayLabel, "Building Checkout Flow")
    }

    func testTodayViewModelFallsBackToRuleBasedLabelWithoutCachedLabel() async throws {
        let database = try AppDatabase.inMemory()
        let day = calendar.startOfDay(for: Date())

        try seed(database: database, day: day, sessions: [
            makeSession(
                day: day,
                bundleID: "com.apple.dt.Xcode",
                appName: "Xcode",
                startMinute: 9 * 60,
                durationMinutes: 60,
                category: .development
            ),
        ])

        let viewModel = TodayViewModel(database: database, blockLabelCache: blockLabelCache)
        viewModel.load(for: day)
        await waitUntil("TodayViewModel fallback label load completes") { !viewModel.isLoading }

        XCTAssertEqual(viewModel.workBlocks.first?.displayLabel, "Xcode")
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

    private func makeBlock(day: Date) -> WorkContextBlock {
        WorkContextBlock(
            id: UUID(),
            startTime: day.addingTimeInterval(9 * 3600),
            endTime: day.addingTimeInterval((10 * 3600) + (15 * 60)),
            dominantCategory: .development,
            categoryDistribution: [.development: 4_500],
            ruleBasedLabel: "Development",
            aiLabel: nil,
            sessions: [],
            topApps: [],
            websites: [],
            switchCount: 0,
            confidence: .high,
            isLive: false
        )
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
