import Foundation
import GRDB

struct UserProfile: Codable, Identifiable, FetchableRecord, PersistableRecord, TableRecord {
    var id: Int64?
    var name: String
    var role: String
    var goals: String
    var workHoursStart: Int
    var workHoursEnd: Int
    var idealDayDescription: String
    var biggestDistraction: String?
    var createdAt: Date
    var updatedAt: Date

    static let databaseTableName = "user_profiles"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
