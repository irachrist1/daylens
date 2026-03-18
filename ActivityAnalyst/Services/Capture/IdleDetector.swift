import Foundation
#if canImport(IOKit)
import IOKit
#endif

/// Detects user idle state by monitoring time since last keyboard/mouse input.
/// Uses IOKit HID system idle time on macOS for zero-polling overhead when idle.
final class IdleDetector {
    var onIdleStateChanged: ((Bool) -> Void)?

    private var isCurrentlyIdle = false
    private var checkTimer: Timer?
    private let graceInterval: TimeInterval

    init(graceInterval: TimeInterval = TrackingRules.idleGracePeriod) {
        self.graceInterval = graceInterval
    }

    func startMonitoring() {
        checkTimer = Timer.scheduledTimer(
            withTimeInterval: 5.0,
            repeats: true
        ) { [weak self] _ in
            self?.checkIdleState()
        }
    }

    func stopMonitoring() {
        checkTimer?.invalidate()
        checkTimer = nil

        if isCurrentlyIdle {
            isCurrentlyIdle = false
            onIdleStateChanged?(false)
        }
    }

    private func checkIdleState() {
        let idleTime = systemIdleTime()
        let shouldBeIdle = idleTime >= graceInterval

        if shouldBeIdle != isCurrentlyIdle {
            isCurrentlyIdle = shouldBeIdle
            onIdleStateChanged?(shouldBeIdle)
        }
    }

    /// Returns seconds since last user input event (keyboard/mouse).
    /// Uses IOKit HID system on macOS.
    func systemIdleTime() -> TimeInterval {
        #if canImport(IOKit)
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
        guard kr == KERN_SUCCESS, let dict = unmanagedDict?.takeRetainedValue() as? [String: Any] else {
            return 0
        }

        guard let idleTime = dict["HIDIdleTime"] as? Int64 else { return 0 }

        return TimeInterval(idleTime) / 1_000_000_000.0
        #else
        return 0
        #endif
    }
}
