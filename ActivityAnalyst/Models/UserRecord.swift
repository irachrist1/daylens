import Foundation
#if canImport(GRDB)
import GRDB
#endif

/// Represents the local user profile.
/// Single row — one user per device installation.
struct UserRecord: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var displayName: String?
    var createdAt: Date
    var lastActiveAt: Date
    var onboardingCompleted: Bool
    var selectedAIModel: AIModel
    var apiKeyConfigured: Bool

    init(
        id: UUID = UUID(),
        displayName: String? = nil,
        createdAt: Date = Date(),
        lastActiveAt: Date = Date(),
        onboardingCompleted: Bool = false,
        selectedAIModel: AIModel = .sonnet,
        apiKeyConfigured: Bool = false
    ) {
        self.id = id
        self.displayName = displayName
        self.createdAt = createdAt
        self.lastActiveAt = lastActiveAt
        self.onboardingCompleted = onboardingCompleted
        self.selectedAIModel = selectedAIModel
        self.apiKeyConfigured = apiKeyConfigured
    }
}

#if canImport(GRDB)
extension UserRecord: FetchableRecord, PersistableRecord {
    static let databaseTableName = "users"

    enum Columns: String, ColumnExpression {
        case id, displayName, createdAt, lastActiveAt
        case onboardingCompleted, selectedAIModel, apiKeyConfigured
    }
}
#endif
