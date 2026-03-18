import Foundation
import GRDB

enum ConversationRole: String, Codable {
    case user      = "user"
    case assistant = "assistant"
    case system    = "system"
}

struct ConversationMessage: Codable, Identifiable {
    var id: String = UUID().uuidString
    var role: ConversationRole
    var content: String
    var timestamp: Double = Date().timeIntervalSince1970
    var evidenceKeys: [String]?   // DB row IDs cited in this response

    var date: Date { Date(timeIntervalSince1970: timestamp) }
}

struct AIConversation: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "ai_conversations"

    var id: String
    var startedAt: Double
    var messagesJson: String       // JSON array of ConversationMessage

    var startDate: Date { Date(timeIntervalSince1970: startedAt) }

    init(
        id: String = UUID().uuidString,
        startedAt: Double = Date().timeIntervalSince1970,
        messages: [ConversationMessage] = []
    ) {
        self.id = id
        self.startedAt = startedAt
        self.messagesJson = (try? JSONEncoder().encode(messages))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
    }

    var messages: [ConversationMessage] {
        guard let data = messagesJson.data(using: .utf8),
              let msgs = try? JSONDecoder().decode([ConversationMessage].self, from: data)
        else { return [] }
        return msgs
    }

    mutating func appendMessage(_ message: ConversationMessage) {
        var current = messages
        current.append(message)
        messagesJson = (try? JSONEncoder().encode(current))
            .flatMap { String(data: $0, encoding: .utf8) } ?? messagesJson
    }
}
