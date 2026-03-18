import AppKit
import Observation
import IOKit

/// Detects user idle state via system idle time (IOKit).
@Observable
final class IdleDetector {
    var isIdle: Bool = false
    private var timer: Timer?
    private var onIdleStateChanged: ((Bool) -> Void)?

    func start(onIdleStateChanged: @escaping (Bool) -> Void) {
        self.onIdleStateChanged = onIdleStateChanged

        // Poll every 5 seconds — lightweight check
        timer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.checkIdleState()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        isIdle = false
    }

    private func checkIdleState() {
        let idleTime = systemIdleTime()
        let wasIdle = isIdle
        isIdle = idleTime >= Constants.idleThreshold

        if isIdle != wasIdle {
            onIdleStateChanged?(isIdle)
        }
    }

    /// Returns the system idle time in seconds using IOKit.
    private func systemIdleTime() -> TimeInterval {
        var iterator: io_iterator_t = 0
        let result = IOServiceGetMatchingServices(
            kIOMainPortDefault,
            IOServiceMatching("IOHIDSystem"),
            &iterator
        )

        guard result == KERN_SUCCESS else { return 0 }
        defer { IOObjectRelease(iterator) }

        let entry = IOIteratorNext(iterator)
        guard entry != 0 else { return 0 }
        defer { IOObjectRelease(entry) }

        var unmanagedDict: Unmanaged<CFMutableDictionary>?
        let kr = IORegistryEntryCreateCFProperties(entry, &unmanagedDict, kCFAllocatorDefault, 0)
        guard kr == KERN_SUCCESS, let dict = unmanagedDict?.takeRetainedValue() as? [String: Any] else { return 0 }

        if let idleTime = dict["HIDIdleTime"] as? Int64 {
            // HIDIdleTime is in nanoseconds
            return TimeInterval(idleTime) / 1_000_000_000.0
        }

        return 0
    }
}
