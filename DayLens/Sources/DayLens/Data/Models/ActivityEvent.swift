import Foundation
import GRDB

// MARK: - Event Types

enum ActivityEventType: String, Codable {
    case appActivated     = "app_activated"
    case appDeactivated   = "app_deactivated"
    case appLaunched      = "app_launched"
    case appTerminated    = "app_terminated"
    case websiteVisit     = "website_visit"
    case idleStart        = "idle_start"
    case idleEnd          = "idle_end"
    case browserTabChange = "browser_tab_change"
}

enum ActivityEventSource: String, Codable {
    case nsworkspace         = "nsworkspace"
    case extensionChromium   = "extension_chromium"
    case extensionSafari     = "extension_safari"
    case heuristicTitle      = "heuristic_title"
    case idleDetector        = "idle_detector"
}

// MARK: - ActivityEvent

/// Raw, append-only capture record. Every system event lands here first
/// before being normalized into sessions.
struct ActivityEvent: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "activity_events"

    var id: String                      // UUID string
    var timestamp: Double               // Unix epoch (seconds with sub-second precision)
    var eventType: String               // ActivityEventType raw value
    var appBundleId: String?
    var appName: String?
    var browserName: String?
    var domain: String?
    var pageTitle: String?
    var urlSlug: String?
    var isPrivate: Bool
    var source: String                  // ActivityEventSource raw value
    var confidence: Double              // 0.0 – 1.0

    // Convenience computed properties
    var type: ActivityEventType? { ActivityEventType(rawValue: eventType) }
    var eventSource: ActivityEventSource? { ActivityEventSource(rawValue: source) }
    var date: Date { Date(timeIntervalSince1970: timestamp) }

    init(
        id: String = UUID().uuidString,
        timestamp: Double = Date().timeIntervalSince1970,
        eventType: ActivityEventType,
        appBundleId: String? = nil,
        appName: String? = nil,
        browserName: String? = nil,
        domain: String? = nil,
        pageTitle: String? = nil,
        urlSlug: String? = nil,
        isPrivate: Bool = false,
        source: ActivityEventSource,
        confidence: Double = 1.0
    ) {
        self.id = id
        self.timestamp = timestamp
        self.eventType = eventType.rawValue
        self.appBundleId = appBundleId
        self.appName = appName
        self.browserName = browserName
        self.domain = domain
        self.pageTitle = isPrivate ? nil : pageTitle
        self.urlSlug = isPrivate ? nil : urlSlug
        self.isPrivate = isPrivate
        self.source = source.rawValue
        self.confidence = confidence
    }
}
