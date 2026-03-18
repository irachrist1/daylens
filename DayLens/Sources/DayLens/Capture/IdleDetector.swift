import Foundation
import CoreGraphics

/// Polls CGEventSource to detect user inactivity.
/// Calls onIdle when the user has been idle past the grace period,
/// and onResume when activity is detected again.
///
/// Uses a 10-second polling interval to keep CPU overhead negligible.
final class IdleDetector {
    private let settings: UserSettings
    private let onIdle: () -> Void
    private let onResume: () -> Void

    private var timer: Timer?
    private var isCurrentlyIdle = false
    private(set) var isRunning = false

    /// How frequently to poll for idle state (seconds)
    private let pollInterval: Double = 10

    init(settings: UserSettings, onIdle: @escaping () -> Void, onResume: @escaping () -> Void) {
        self.settings = settings
        self.onIdle = onIdle
        self.onResume = onResume
    }

    // MARK: - Lifecycle

    func start() {
        guard !isRunning else { return }
        isRunning = true
        scheduleTimer()
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        timer?.invalidate()
        timer = nil
        // Treat stop as a resume so sessions close cleanly
        if isCurrentlyIdle {
            isCurrentlyIdle = false
        }
    }

    // MARK: - Polling

    private func scheduleTimer() {
        timer = Timer.scheduledTimer(
            withTimeInterval: pollInterval,
            repeats: true
        ) { [weak self] _ in
            self?.checkIdle()
        }
        // Run in common modes so it fires even when UI is being manipulated
        RunLoop.main.add(timer!, forMode: .common)
    }

    private func checkIdle() {
        guard !settings.isTrackingPaused else { return }

        let secondsIdle = secondsSinceLastInput()

        if !isCurrentlyIdle && secondsIdle >= settings.idleGraceSeconds {
            isCurrentlyIdle = true
            onIdle()
        } else if isCurrentlyIdle && secondsIdle < settings.idleGraceSeconds {
            isCurrentlyIdle = false
            onResume()
        }
    }

    // MARK: - CGEventSource query

    /// Returns seconds since the last keyboard or mouse event.
    func secondsSinceLastInput() -> Double {
        // CGEventSource.secondsSinceLastEventType returns seconds since the last
        // event of the specified type in the combined session state.
        let keyboard = CGEventSource.secondsSinceLastEventType(
            .combinedSessionState,
            eventType: .keyDown
        )
        let mouse = CGEventSource.secondsSinceLastEventType(
            .combinedSessionState,
            eventType: .mouseMoved
        )
        let click = CGEventSource.secondsSinceLastEventType(
            .combinedSessionState,
            eventType: .leftMouseDown
        )
        return min(keyboard, min(mouse, click))
    }
}
