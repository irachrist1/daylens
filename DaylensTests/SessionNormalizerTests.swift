import XCTest

#if canImport(Daylens)
@testable import Daylens
#else
@testable import DaylensCore
#endif

final class SessionNormalizerTests: XCTestCase {

    // MARK: - Focus Score

    func testFocusScoreAllProductivity() {
        // All sessions in productivity category → high focus score
        let sessions = [
            makeSession(bundleID: "com.apple.dt.Xcode", category: .development, duration: 3600),
            makeSession(bundleID: "com.apple.dt.Xcode", category: .development, duration: 1800),
        ]
        let score = computeFocusScore(sessions: sessions, totalTime: 5400)
        XCTAssertGreaterThan(score, 0.99, "All-productivity sessions should yield high focus score")
    }

    func testFocusScoreAllEntertainment() {
        let sessions = [
            makeSession(bundleID: "com.spotify.client", category: .entertainment, duration: 3600),
        ]
        let score = computeFocusScore(sessions: sessions, totalTime: 3600)
        XCTAssertLessThan(score, 0.3, "All-entertainment should yield low focus score")
    }

    func testFocusScoreHighSwitching() {
        // Many short sessions → penalized
        var sessions: [AppSession] = []
        for i in 0..<60 {
            sessions.append(makeSession(
                bundleID: "com.apple.dt.Xcode",
                category: .development,
                duration: 60,
                startOffset: TimeInterval(i * 60)
            ))
        }
        let score = computeFocusScore(sessions: sessions, totalTime: 3600)
        XCTAssertEqual(score, 0.85, accuracy: 0.01, "High switching rate should cap the focus score at the unified 15% penalty")
    }

    func testFocusScoreIncludesWebsiteCredit() {
        let score = FocusScoreCalculator.compute(
            focusedTime: 1800,
            totalTime: 3600,
            sessionCount: 2,
            websiteFocusCredit: 900
        )

        XCTAssertGreaterThan(score, 0.7)
        XCTAssertLessThanOrEqual(score, 0.75)
    }

    // MARK: - Session Merge Rules

    func testMinimumUsageDuration() {
        XCTAssertEqual(Constants.minimumUsageDuration, 3.0)
    }

    func testSessionMergeThreshold() {
        // Gaps under 8 seconds should be mergeable
        XCTAssertEqual(Constants.sessionMergeThreshold, 8.0)
    }

    func testRecomputeAllDailySummariesRepairsStoredRows() throws {
        let database = try AppDatabase.inMemory()
        let normalizer = SessionNormalizer(database: database)
        let day = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_710_000_000))

        try database.insertAppSession(
            AppSession(
                date: day,
                bundleID: "com.apple.dt.Xcode",
                appName: "Xcode",
                startTime: day.addingTimeInterval(9 * 3600),
                endTime: day.addingTimeInterval(10 * 3600),
                duration: 3600,
                category: .development,
                isBrowser: false
            )
        )
        try database.insertAppSession(
            AppSession(
                date: day,
                bundleID: "com.spotify.client",
                appName: "Spotify",
                startTime: day.addingTimeInterval(10 * 3600 + 300),
                endTime: day.addingTimeInterval(10 * 3600 + 2100),
                duration: 1800,
                category: .entertainment,
                isBrowser: false
            )
        )

        try database.saveDailySummary(
            DailySummary(
                date: day,
                totalActiveTime: 1,
                totalIdleTime: 0,
                appCount: 0,
                browserCount: 0,
                domainCount: 0,
                sessionCount: 0,
                contextSwitches: 0,
                focusScore: 0.01,
                longestFocusStreak: 0,
                topAppBundleID: nil,
                topDomain: nil,
                aiSummary: "keep me",
                aiSummaryGeneratedAt: nil
            )
        )

        try normalizer.recomputeAllDailySummaries()

        let repaired = try XCTUnwrap(database.dailySummary(for: day))
        let expected = FocusScoreCalculator.compute(
            focusedTime: 3600,
            totalTime: 5400,
            sessionCount: 2
        )

        XCTAssertEqual(repaired.totalActiveTime, 5400, accuracy: 0.001)
        XCTAssertEqual(repaired.focusScore, expected, accuracy: 0.001)
        XCTAssertEqual(repaired.topAppBundleID, "com.apple.dt.Xcode")
        XCTAssertEqual(repaired.aiSummary, "keep me")
    }

    // MARK: - Helpers

    private func makeSession(
        bundleID: String,
        category: AppCategory,
        duration: TimeInterval,
        startOffset: TimeInterval = 0
    ) -> AppSession {
        let start = Date().addingTimeInterval(startOffset)
        return AppSession(
            date: Calendar.current.startOfDay(for: start),
            bundleID: bundleID,
            appName: "Test App",
            startTime: start,
            endTime: start.addingTimeInterval(duration),
            duration: duration,
            category: category,
            isBrowser: false
        )
    }

    private func computeFocusScore(sessions: [AppSession], totalTime: TimeInterval) -> Double {
        let focusedTime = sessions.filter { $0.category.isFocused }.reduce(0.0) { $0 + $1.duration }
        return FocusScoreCalculator.compute(
            focusedTime: focusedTime,
            totalTime: totalTime,
            sessionCount: sessions.count
        )
    }
}
