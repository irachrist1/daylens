import Foundation
import GRDB

/// A website/domain visit record.
struct WebsiteVisit: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: Int64?
    var date: Date              // Calendar day
    var domain: String
    var fullURL: String?
    var pageTitle: String?
    var browserBundleID: String
    var startTime: Date
    var endTime: Date
    var duration: TimeInterval
    var confidence: ActivityEvent.ConfidenceLevel
    var source: ActivityEvent.EventSource

    static let databaseTableName = "website_visits"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }

    var formattedDuration: String {
        let hours = Int(duration) / 3600
        let minutes = (Int(duration) % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        if minutes > 0 {
            return "\(minutes)m"
        }
        let seconds = Int(duration) % 60
        return "\(seconds)s"
    }
}

/// Aggregated website usage for a given day.
struct WebsiteUsageSummary: Identifiable {
    let domain: String
    let totalDuration: TimeInterval
    let visitCount: Int
    let representativePageTitle: String?
    let activePageTitle: String?
    let confidence: ActivityEvent.ConfidenceLevel
    let browserName: String
    let browserBreakdowns: [WebsiteBrowserBreakdown]

    var id: String { domain }

    init(
        domain: String,
        totalDuration: TimeInterval,
        visitCount: Int,
        topPageTitle: String?,
        confidence: ActivityEvent.ConfidenceLevel,
        browserName: String,
        activePageTitle: String? = nil,
        browserBreakdowns: [WebsiteBrowserBreakdown] = []
    ) {
        self.domain = domain
        self.totalDuration = totalDuration
        self.visitCount = visitCount
        self.representativePageTitle = topPageTitle
        self.activePageTitle = activePageTitle
        self.confidence = confidence
        self.browserName = browserName
        self.browserBreakdowns = browserBreakdowns
    }

    var topPageTitle: String? {
        activePageTitle ?? representativePageTitle
    }

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

struct WebsiteBrowserBreakdown: Identifiable, Hashable {
    let browserBundleID: String
    let browserName: String
    let totalDuration: TimeInterval
    let representativePageTitle: String?
    let activePageTitle: String?

    var id: String { "\(browserBundleID)|\(browserName)" }

    var subtitle: String? {
        activePageTitle ?? representativePageTitle
    }
}

/// Aggregated page-level website usage for a specific domain.
struct WebsitePageSummary: Identifiable {
    let domain: String
    let url: String
    let title: String?
    let totalDuration: TimeInterval

    var id: String { url }
}
