import Foundation
import GRDB

/// Cached daily summary with pre-computed metrics.
struct DailySummary: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: Int64?
    var date: Date
    var totalActiveTime: TimeInterval
    var totalIdleTime: TimeInterval
    var appCount: Int
    var browserCount: Int
    var domainCount: Int
    var sessionCount: Int
    var contextSwitches: Int
    var focusScore: Double          // 0.0 to 1.0
    var longestFocusStreak: TimeInterval
    var topAppBundleID: String?
    var topDomain: String?
    var aiSummary: String?
    var aiSummaryGeneratedAt: Date?

    static let databaseTableName = "daily_summaries"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }

    var formattedActiveTime: String {
        let hours = Int(totalActiveTime) / 3600
        let minutes = (Int(totalActiveTime) % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }

    var focusScorePercent: Int {
        Int(focusScore * 100)
    }

    var focusScoreLabel: String {
        switch focusScore {
        case 0.8...: return "Deep Focus"
        case 0.6..<0.8: return "Focused"
        case 0.4..<0.6: return "Mixed"
        case 0.2..<0.4: return "Scattered"
        default: return "Fragmented"
        }
    }
}
