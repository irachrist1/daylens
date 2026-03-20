import Foundation
import Observation

/// Lightweight focus-session timer.
/// A session runs for a fixed target duration; progress is 0→1.
@Observable
final class FocusSessionManager {
    var isRunning = false
    var elapsed: TimeInterval = 0
    var targetMinutes: Int = 25

    var onTick: (() -> Void)?

    private var timer: Timer?
    private var startedAt: Date?

    var target: TimeInterval { TimeInterval(targetMinutes * 60) }

    var progress: Double {
        guard target > 0 else { return 0 }
        return min(elapsed / target, 1.0)
    }

    var formattedRemaining: String {
        let remaining = max(0, target - elapsed)
        let m = Int(remaining) / 60
        let s = Int(remaining) % 60
        return String(format: "%d:%02d", m, s)
    }

    var formattedElapsed: String {
        let m = Int(elapsed) / 60
        let s = Int(elapsed) % 60
        return String(format: "%d:%02d", m, s)
    }

    func start(minutes: Int = 25) {
        targetMinutes = minutes
        elapsed = 0
        startedAt = Date()
        isRunning = true
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, let startedAt = self.startedAt else { return }
            self.elapsed = Date().timeIntervalSince(startedAt)
            if self.elapsed >= self.target {
                self.finish()
            } else {
                self.onTick?()
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        isRunning = false
        elapsed = 0
        startedAt = nil
        onTick?()
    }

    private func finish() {
        timer?.invalidate()
        timer = nil
        isRunning = false
        onTick?()
    }
}
