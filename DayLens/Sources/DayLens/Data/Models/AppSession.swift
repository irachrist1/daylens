import Foundation
import GRDB

/// A normalized, post-processed record of a user actually using an app.
/// Sub-5s events are excluded; rapid switches are merged; idle time is clipped.
struct AppSession: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "app_sessions"

    var id: String
    var appBundleId: String
    var appName: String
    var appIconPath: String?
    var startedAt: Double               // Unix epoch
    var endedAt: Double?                // nil while session is still open
    var activeDuration: Double          // seconds of confirmed active use
    var wasIdle: Bool
    var dateKey: String                 // YYYY-MM-DD for fast range queries

    var startDate: Date { Date(timeIntervalSince1970: startedAt) }
    var endDate: Date? { endedAt.map { Date(timeIntervalSince1970: $0) } }
    var isOpen: Bool { endedAt == nil }

    init(
        id: String = UUID().uuidString,
        appBundleId: String,
        appName: String,
        appIconPath: String? = nil,
        startedAt: Double = Date().timeIntervalSince1970,
        endedAt: Double? = nil,
        activeDuration: Double = 0,
        wasIdle: Bool = false,
        dateKey: String? = nil
    ) {
        self.id = id
        self.appBundleId = appBundleId
        self.appName = appName
        self.appIconPath = appIconPath
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.activeDuration = activeDuration
        self.wasIdle = wasIdle
        self.dateKey = dateKey ?? Self.makeDateKey(from: startedAt)
    }

    static func makeDateKey(from timestamp: Double) -> String {
        let date = Date(timeIntervalSince1970: timestamp)
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        return formatter.string(from: date)
    }
}

// MARK: - Aggregated view for dashboard

struct AppUsageSummary: Identifiable {
    let id: String       // bundleId
    let appName: String
    let appBundleId: String
    let appIconPath: String?
    let totalSeconds: Double
    let sessionCount: Int
    let dateKey: String
}
