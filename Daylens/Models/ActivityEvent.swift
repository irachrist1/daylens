import Foundation
import GRDB

/// A raw activity event captured by the tracking system.
struct ActivityEvent: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: Int64?
    var timestamp: Date
    var eventType: EventType
    var bundleID: String
    var appName: String
    var windowTitle: String?
    var domain: String?
    var pageTitle: String?
    var duration: TimeInterval?
    var isIdle: Bool
    var confidence: ConfidenceLevel
    var source: EventSource

    static let databaseTableName = "activity_events"

    enum EventType: String, Codable, DatabaseValueConvertible {
        case appActivated = "app_activated"
        case appDeactivated = "app_deactivated"
        case websiteVisit = "website_visit"
        case idleStart = "idle_start"
        case idleEnd = "idle_end"
    }

    enum ConfidenceLevel: String, Codable, DatabaseValueConvertible {
        case high       // From browser history DB or extension
        case medium     // From accessibility/window title
        case low        // Heuristic only
    }

    enum EventSource: String, Codable, DatabaseValueConvertible {
        case nsworkspace
        case accessibility
        case browserHistory
        case browserExtension
        case idle
    }

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
