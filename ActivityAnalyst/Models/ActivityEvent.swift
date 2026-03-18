import Foundation
#if canImport(GRDB)
import GRDB
#endif

struct ActivityEvent: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var timestamp: Date
    var eventType: EventType
    var appId: UUID
    var browserId: UUID?
    var websiteId: UUID?
    var windowTitle: String?
    var url: String?
    var pageTitle: String?
    var source: CaptureSource
    var confidence: Double
    var isPrivateBrowsing: Bool
    var metadata: [String: String]?

    init(
        id: UUID = UUID(),
        timestamp: Date = Date(),
        eventType: EventType,
        appId: UUID,
        browserId: UUID? = nil,
        websiteId: UUID? = nil,
        windowTitle: String? = nil,
        url: String? = nil,
        pageTitle: String? = nil,
        source: CaptureSource = .native,
        confidence: Double = 1.0,
        isPrivateBrowsing: Bool = false,
        metadata: [String: String]? = nil
    ) {
        self.id = id
        self.timestamp = timestamp
        self.eventType = eventType
        self.appId = appId
        self.browserId = browserId
        self.websiteId = websiteId
        self.windowTitle = windowTitle
        self.url = url
        self.pageTitle = pageTitle
        self.source = source
        self.confidence = confidence
        self.isPrivateBrowsing = isPrivateBrowsing
        self.metadata = metadata
    }
}

#if canImport(GRDB)
extension ActivityEvent: FetchableRecord, PersistableRecord {
    static let databaseTableName = "activity_events"

    enum Columns: String, ColumnExpression {
        case id, timestamp, eventType, appId, browserId, websiteId
        case windowTitle, url, pageTitle
        case source, confidence, isPrivateBrowsing, metadata
    }
}
#endif

extension ActivityEvent {
    var isAppEvent: Bool {
        switch eventType {
        case .appActivated, .appDeactivated, .appLaunched, .appTerminated:
            return true
        default:
            return false
        }
    }

    var isBrowserEvent: Bool {
        browserId != nil
    }

    var isWebsiteEvent: Bool {
        websiteId != nil || url != nil
    }

    var isIdleEvent: Bool {
        eventType == .idleStart || eventType == .idleEnd
    }
}
