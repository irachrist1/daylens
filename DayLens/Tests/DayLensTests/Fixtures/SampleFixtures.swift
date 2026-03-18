import Foundation
@testable import DayLens

/// Replayable sample timelines for testing capture and aggregation logic.
enum SampleFixtures {

    // MARK: - A realistic 8-hour workday

    /// A typical workday: mix of Xcode, Slack, Chrome, Safari, idle periods.
    static let workdayTimeline: [ActivityEvent] = {
        let base: Double = 1_700_000_000  // Deterministic base timestamp
        var events: [ActivityEvent] = []

        func at(_ offset: Double, type: ActivityEventType, bundleId: String, name: String, source: ActivityEventSource = .nsworkspace) -> ActivityEvent {
            ActivityEvent(timestamp: base + offset, eventType: type, appBundleId: bundleId, appName: name, source: source)
        }

        // 9:00 AM — open Xcode
        events.append(at(0, type: .appLaunched, bundleId: "com.apple.dt.Xcode", name: "Xcode"))
        events.append(at(1, type: .appActivated, bundleId: "com.apple.dt.Xcode", name: "Xcode"))
        // 10:30 AM — switch to Slack (90 min of Xcode = 5400s)
        events.append(at(5400, type: .appDeactivated, bundleId: "com.apple.dt.Xcode", name: "Xcode"))
        events.append(at(5401, type: .appActivated, bundleId: "com.tinyspeck.slackmacgap", name: "Slack"))
        // 10:35 — back to Xcode (5 min Slack)
        events.append(at(5701, type: .appDeactivated, bundleId: "com.tinyspeck.slackmacgap", name: "Slack"))
        events.append(at(5702, type: .appActivated, bundleId: "com.apple.dt.Xcode", name: "Xcode"))
        // 12:00 — lunch idle for 45 min
        events.append(at(10_800, type: .idleStart, appBundleId: nil, appName: nil, source: .idleDetector))
        events.append(at(13_500, type: .idleEnd, appBundleId: nil, appName: nil, source: .idleDetector))
        // 1:00 PM — Chrome for research (YouTube for 12 min)
        events.append(at(14_400, type: .appActivated, bundleId: "com.google.Chrome", name: "Chrome"))
        events.append(at(14_401, type: .websiteVisit, bundleId: nil, appName: nil, browserName: "chrome", domain: "youtube.com", pageTitle: "SwiftUI Tutorial - YouTube", source: .extensionChromium))
        events.append(at(15_120, type: .websiteVisit, bundleId: nil, appName: nil, browserName: "chrome", domain: "github.com", pageTitle: "GRDB - GitHub", source: .extensionChromium))
        events.append(at(16_200, type: .appDeactivated, bundleId: "com.google.Chrome", name: "Chrome"))
        events.append(at(16_201, type: .appActivated, bundleId: "com.apple.dt.Xcode", name: "Xcode"))
        // 5:00 PM — end of day
        events.append(at(28_800, type: .appTerminated, bundleId: "com.apple.dt.Xcode", name: "Xcode"))

        return events
    }()

    // MARK: - Rapid switching burst (Stage Manager scenario)

    /// 10 rapid switches between Xcode and Slack within 30 seconds.
    static func rapidSwitchBurst(baseTimestamp: Double = 1_700_100_000) -> [ActivityEvent] {
        var events: [ActivityEvent] = []
        var t = baseTimestamp

        for i in 0..<10 {
            let isXcode = i % 2 == 0
            let bundleId = isXcode ? "com.apple.dt.Xcode" : "com.tinyspeck.slackmacgap"
            let name = isXcode ? "Xcode" : "Slack"
            events.append(ActivityEvent(timestamp: t, eventType: .appActivated,
                                         appBundleId: bundleId, appName: name, source: .nsworkspace))
            t += 3  // 3-second intervals — should merge (< 8s gap)
        }
        return events
    }

    // MARK: - Idle-heavy day

    static func idleHeavyDay(baseTimestamp: Double = 1_700_200_000) -> [ActivityEvent] {
        var events: [ActivityEvent] = []
        // 10 min active
        events.append(ActivityEvent(timestamp: baseTimestamp, eventType: .appActivated,
                                     appBundleId: "com.apple.Safari", appName: "Safari", source: .nsworkspace))
        // 3 hours idle
        events.append(ActivityEvent(timestamp: baseTimestamp + 600, eventType: .idleStart, source: .idleDetector))
        events.append(ActivityEvent(timestamp: baseTimestamp + 11400, eventType: .idleEnd, source: .idleDetector))
        // 5 min active
        events.append(ActivityEvent(timestamp: baseTimestamp + 11400, eventType: .appActivated,
                                     appBundleId: "com.apple.Safari", appName: "Safari", source: .nsworkspace))
        events.append(ActivityEvent(timestamp: baseTimestamp + 11700, eventType: .appDeactivated,
                                     appBundleId: "com.apple.Safari", appName: "Safari", source: .nsworkspace))
        return events
    }
}

// Convenience extension to make fixture creation less verbose
private extension ActivityEvent {
    init(timestamp: Double, eventType: ActivityEventType, appBundleId: String? = nil,
         appName: String? = nil, browserName: String? = nil, domain: String? = nil,
         pageTitle: String? = nil, source: ActivityEventSource) {
        self.init(timestamp: timestamp, eventType: eventType, appBundleId: appBundleId,
                  appName: appName, browserName: browserName, domain: domain,
                  pageTitle: pageTitle, source: source)
    }
}
