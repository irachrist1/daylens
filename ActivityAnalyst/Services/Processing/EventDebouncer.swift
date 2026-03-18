import Foundation

/// Coalesces rapid-fire events within a configurable time window.
/// Prevents noisy data from rapid app switching, window resizing, etc.
final class EventDebouncer {
    private let debounceWindow: TimeInterval
    private var lastEvents: [String: (event: ActivityEvent, timestamp: Date)] = [:]

    init(debounceWindow: TimeInterval = TrackingRules.switchDebounceWindow) {
        self.debounceWindow = debounceWindow
    }

    /// Returns the event if it should be forwarded, nil if it should be debounced.
    func process(_ event: ActivityEvent) -> ActivityEvent? {
        let key = debounceKey(for: event)

        if let last = lastEvents[key] {
            let elapsed = event.timestamp.timeIntervalSince(last.timestamp)
            if elapsed < debounceWindow && event.eventType == last.event.eventType {
                lastEvents[key] = (event: event, timestamp: event.timestamp)
                return nil
            }
        }

        lastEvents[key] = (event: event, timestamp: event.timestamp)
        return event
    }

    /// Processes a batch of events, returning only those that survive debouncing.
    func processBatch(_ events: [ActivityEvent]) -> [ActivityEvent] {
        events.compactMap { process($0) }
    }

    /// Clears the debounce state. Call when tracking is paused/stopped.
    func reset() {
        lastEvents.removeAll()
    }

    private func debounceKey(for event: ActivityEvent) -> String {
        var key = "\(event.eventType.rawValue):\(event.appId)"
        if let browserId = event.browserId {
            key += ":\(browserId)"
        }
        if let websiteId = event.websiteId {
            key += ":\(websiteId)"
        }
        return key
    }
}
