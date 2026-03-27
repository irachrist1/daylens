import Foundation
import GRDB

struct GeneratedReport: Codable, Identifiable, FetchableRecord, PersistableRecord, TableRecord {
    var id: Int64?
    var reportType: String
    var periodStart: Date
    var periodEnd: Date
    var markdownContent: String
    var generatedByAI: Bool
    var createdAt: Date

    static let databaseTableName = "generated_reports"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
