import Foundation
import GRDB

struct UserMemory: Codable, Identifiable, FetchableRecord, PersistableRecord, TableRecord {
    var id: Int64?
    var fact: String
    var source: String
    var createdAt: Date

    static let databaseTableName = "user_memories"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
