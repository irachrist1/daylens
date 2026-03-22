import Foundation

enum FocusScoreCalculator {
    /// Unified focus score computation.
    /// - Parameters:
    ///   - focusedTime: Total seconds in focused categories
    ///   - totalTime: Total tracked seconds
    ///   - sessionCount: Number of individual sessions (for context-switch penalty)
    ///   - websiteFocusCredit: Seconds of focused website time within browser apps (default 0)
    /// - Returns: Score from 0.0 to 1.0
    static func compute(
        focusedTime: TimeInterval,
        totalTime: TimeInterval,
        sessionCount: Int,
        websiteFocusCredit: TimeInterval = 0
    ) -> Double {
        guard totalTime > 0 else { return 0 }
        let focusRatio = (focusedTime + websiteFocusCredit) / totalTime
        let switchRate = Double(sessionCount) / max(totalTime / 3600.0, 0.1)
        let switchPenalty = min(switchRate / 300.0, 0.15)
        return min(1.0, max(0, focusRatio * (1.0 - switchPenalty)))
    }
}
