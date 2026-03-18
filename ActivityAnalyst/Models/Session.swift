import Foundation
#if canImport(GRDB)
import GRDB
#endif

struct Session: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var appId: UUID
    var browserId: UUID?
    var websiteId: UUID?
    var startTime: Date
    var endTime: Date
    var duration: TimeInterval
    var idleDuration: TimeInterval
    var eventCount: Int
    var source: CaptureSource
    var confidence: Double
    var category: ActivityCategory
    var isSignificant: Bool

    init(
        id: UUID = UUID(),
        appId: UUID,
        browserId: UUID? = nil,
        websiteId: UUID? = nil,
        startTime: Date,
        endTime: Date,
        duration: TimeInterval,
        idleDuration: TimeInterval = 0,
        eventCount: Int = 1,
        source: CaptureSource = .native,
        confidence: Double = 1.0,
        category: ActivityCategory = .uncategorized,
        isSignificant: Bool = true
    ) {
        self.id = id
        self.appId = appId
        self.browserId = browserId
        self.websiteId = websiteId
        self.startTime = startTime
        self.endTime = endTime
        self.duration = duration
        self.idleDuration = idleDuration
        self.eventCount = eventCount
        self.source = source
        self.confidence = confidence
        self.category = category
        self.isSignificant = isSignificant
    }
}

#if canImport(GRDB)
extension Session: FetchableRecord, PersistableRecord {
    static let databaseTableName = "sessions"

    enum Columns: String, ColumnExpression {
        case id, appId, browserId, websiteId
        case startTime, endTime, duration, idleDuration
        case eventCount, source, confidence, category, isSignificant
    }
}
#endif

extension Session {
    var activeDuration: TimeInterval {
        duration - idleDuration
    }

    var isWebSession: Bool {
        websiteId != nil
    }

    var isBrowserSession: Bool {
        browserId != nil
    }

    func overlaps(with other: Session) -> Bool {
        startTime < other.endTime && endTime > other.startTime
    }

    func canMerge(with other: Session, maxGap: TimeInterval) -> Bool {
        guard appId == other.appId,
              browserId == other.browserId,
              websiteId == other.websiteId else {
            return false
        }

        let gap: TimeInterval
        if endTime <= other.startTime {
            gap = other.startTime.timeIntervalSince(endTime)
        } else if other.endTime <= startTime {
            gap = startTime.timeIntervalSince(other.endTime)
        } else {
            return true
        }

        return gap <= maxGap
    }

    func merged(with other: Session) -> Session {
        let newStart = min(startTime, other.startTime)
        let newEnd = max(endTime, other.endTime)

        return Session(
            id: id,
            appId: appId,
            browserId: browserId ?? other.browserId,
            websiteId: websiteId ?? other.websiteId,
            startTime: newStart,
            endTime: newEnd,
            duration: duration + other.duration,
            idleDuration: idleDuration + other.idleDuration,
            eventCount: eventCount + other.eventCount,
            source: source,
            confidence: min(confidence, other.confidence),
            category: category,
            isSignificant: duration + other.duration >= TrackingRules.minimumSessionDuration
        )
    }
}
