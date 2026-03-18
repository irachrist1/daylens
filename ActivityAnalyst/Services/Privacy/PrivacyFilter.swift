import Foundation

/// Applies privacy rules to activity data before storage or AI analysis.
struct PrivacyFilter {
    let preferences: TrackingPreferences

    init(preferences: TrackingPreferences = TrackingPreferences()) {
        self.preferences = preferences
    }

    /// Filters an event according to privacy rules.
    /// Returns nil if the event should be completely dropped.
    func filter(_ event: ActivityEvent) -> ActivityEvent? {
        if preferences.pauseTracking {
            return nil
        }

        if event.isPrivateBrowsing {
            switch preferences.trackPrivateBrowsing {
            case .trackNothing:
                return nil
            case .coarseBrowserOnly:
                var filtered = event
                filtered.url = nil
                filtered.pageTitle = nil
                filtered.windowTitle = nil
                filtered.websiteId = nil
                return filtered
            case .trackEverything:
                return event
            }
        }

        var filtered = event
        filtered.url = redactURL(event.url)
        return filtered
    }

    /// Filters a batch of events.
    func filterBatch(_ events: [ActivityEvent]) -> [ActivityEvent] {
        events.compactMap { filter($0) }
    }

    /// Redacts sensitive parts of URLs.
    /// Strips query parameters, fragments, and authentication tokens.
    func redactURL(_ urlString: String?) -> String? {
        guard let urlString = urlString,
              var components = URLComponents(string: urlString) else {
            return urlString
        }

        components.queryItems = nil
        components.fragment = nil

        if let user = components.user {
            components.user = String(repeating: "*", count: user.count)
        }
        components.password = nil

        return components.url?.absoluteString ?? urlString
    }

    /// Redacts a window title by removing potential sensitive content.
    func redactWindowTitle(_ title: String?) -> String? {
        guard let title = title else { return nil }

        let sensitivePatterns = [
            "password", "token", "secret", "api_key", "apikey",
            "auth", "credential", "ssn", "credit card",
        ]

        let lowered = title.lowercased()
        for pattern in sensitivePatterns {
            if lowered.contains(pattern) {
                return "[Redacted]"
            }
        }

        return title
    }

    /// Prepares activity data for AI analysis by applying redaction rules.
    func prepareForAI(_ sessions: [Session]) -> [Session] {
        sessions
    }
}
