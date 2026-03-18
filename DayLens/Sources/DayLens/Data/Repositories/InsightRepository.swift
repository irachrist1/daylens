import Foundation
import GRDB

final class InsightRepository {
    private let db: AppDatabase

    init(db: AppDatabase = .shared) {
        self.db = db
    }

    // MARK: - DailySummary

    func saveDailySummary(_ summary: DailySummary) throws {
        try db.write { database in
            try summary.save(database)
        }
    }

    func dailySummary(for dateKey: String) throws -> DailySummary? {
        try db.read { database in
            try DailySummary
                .filter(Column("dateKey") == dateKey)
                .fetchOne(database)
        }
    }

    func recentDailySummaries(limit: Int = 7) throws -> [DailySummary] {
        try db.read { database in
            try DailySummary
                .order(Column("dateKey").desc)
                .limit(limit)
                .fetchAll(database)
        }
    }

    // MARK: - AIConversation

    func saveConversation(_ conversation: AIConversation) throws {
        try db.write { database in
            try conversation.save(database)
        }
    }

    func latestConversation() throws -> AIConversation? {
        try db.read { database in
            try AIConversation
                .order(Column("startedAt").desc)
                .fetchOne(database)
        }
    }

    func allConversations() throws -> [AIConversation] {
        try db.read { database in
            try AIConversation
                .order(Column("startedAt").desc)
                .fetchAll(database)
        }
    }
}
