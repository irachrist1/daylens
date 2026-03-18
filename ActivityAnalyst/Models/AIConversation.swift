import Foundation
#if canImport(GRDB)
import GRDB
#endif

struct AIConversation: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var createdAt: Date
    var title: String?
    var lastMessageAt: Date?

    init(
        id: UUID = UUID(),
        createdAt: Date = Date(),
        title: String? = nil,
        lastMessageAt: Date? = nil
    ) {
        self.id = id
        self.createdAt = createdAt
        self.title = title
        self.lastMessageAt = lastMessageAt
    }
}

struct AIMessage: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var conversationId: UUID
    var role: MessageRole
    var content: String
    var evidence: [EvidenceReference]?
    var createdAt: Date

    init(
        id: UUID = UUID(),
        conversationId: UUID,
        role: MessageRole,
        content: String,
        evidence: [EvidenceReference]? = nil,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.conversationId = conversationId
        self.role = role
        self.content = content
        self.evidence = evidence
        self.createdAt = createdAt
    }
}

#if canImport(GRDB)
extension AIConversation: FetchableRecord, PersistableRecord {
    static let databaseTableName = "ai_conversations"

    enum Columns: String, ColumnExpression {
        case id, createdAt, title, lastMessageAt
    }
}

extension AIMessage: FetchableRecord, PersistableRecord {
    static let databaseTableName = "ai_messages"

    enum Columns: String, ColumnExpression {
        case id, conversationId, role, content, evidence, createdAt
    }
}
#endif
