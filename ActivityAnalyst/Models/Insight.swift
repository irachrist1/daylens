import Foundation
#if canImport(GRDB)
import GRDB
#endif

struct Insight: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var dailySummaryId: UUID
    var type: InsightType
    var title: String
    var body: String
    var evidence: [EvidenceReference]
    var createdAt: Date

    init(
        id: UUID = UUID(),
        dailySummaryId: UUID,
        type: InsightType,
        title: String,
        body: String,
        evidence: [EvidenceReference] = [],
        createdAt: Date = Date()
    ) {
        self.id = id
        self.dailySummaryId = dailySummaryId
        self.type = type
        self.title = title
        self.body = body
        self.evidence = evidence
        self.createdAt = createdAt
    }
}

struct EvidenceReference: Codable, Hashable, Sendable {
    var sessionId: UUID?
    var appName: String?
    var domain: String?
    var duration: TimeInterval?
    var timeRange: String?
    var description: String

    init(
        sessionId: UUID? = nil,
        appName: String? = nil,
        domain: String? = nil,
        duration: TimeInterval? = nil,
        timeRange: String? = nil,
        description: String
    ) {
        self.sessionId = sessionId
        self.appName = appName
        self.domain = domain
        self.duration = duration
        self.timeRange = timeRange
        self.description = description
    }
}

#if canImport(GRDB)
extension Insight: FetchableRecord, PersistableRecord {
    static let databaseTableName = "insights"

    enum Columns: String, ColumnExpression {
        case id, dailySummaryId, type, title, body, evidence, createdAt
    }
}
#endif
