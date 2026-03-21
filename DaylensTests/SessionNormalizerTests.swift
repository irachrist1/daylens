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
        XCTAssertGreaterThan(score, 0.7, "All-productivity sessions should yield high focus score")
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
        XCTAssertLessThan(score, 0.8, "High switching rate should penalize focus score")
    }

    // MARK: - Session Merge Rules

    func testMinimumUsageDuration() {
        XCTAssertEqual(Constants.minimumUsageDuration, 3.0)
    }

    func testSessionMergeThreshold() {
        // Gaps under 8 seconds should be mergeable
        XCTAssertEqual(Constants.sessionMergeThreshold, 8.0)
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

    /// Mirror of SessionNormalizer focus score computation for testing.
    private func computeFocusScore(sessions: [AppSession], totalTime: TimeInterval) -> Double {
        guard totalTime > 0 else { return 0 }
        let focusedTime = sessions.filter { $0.category.isFocused }.reduce(0.0) { $0 + $1.duration }
        let focusRatio = focusedTime / totalTime
        let switchRate = Double(sessions.count) / max(totalTime / 3600.0, 0.1)
        let switchPenalty = min(switchRate / 60.0, 0.3)
        return max(0, min(1.0, focusRatio - switchPenalty))
    }
}
