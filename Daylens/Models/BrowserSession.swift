import Foundation
import GRDB

/// Tracks which browser was used and for how long.
struct BrowserSession: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: Int64?
    var date: Date
    var browserBundleID: String
    var browserName: String
    var startTime: Date
    var endTime: Date
    var duration: TimeInterval

    static let databaseTableName = "browser_sessions"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

/// Aggregated browser usage for a given day.
struct BrowserUsageSummary: Identifiable {
    let browserBundleID: String
    let browserName: String
    let totalDuration: TimeInterval
    let sessionCount: Int
    let topDomains: [String]

    var id: String { browserBundleID }

    var formattedDuration: String {
        let hours = Int(totalDuration) / 3600
        let minutes = (Int(totalDuration) % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        if minutes > 0 {
            return "\(minutes)m"
        }
        return "<1m"
    }
}
