import Foundation
import GRDB

struct WebsiteVisit: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "website_visits"

    var id: String
    var domain: String
    var pageTitle: String?
    var urlSlug: String?
    var browserName: String
    var startedAt: Double
    var endedAt: Double?
    var duration: Double          // seconds of confirmed active time on this page
    var isPrivate: Bool
    var confidence: Double        // 1.0 = extension, 0.5 = title heuristic, 0.3 = fallback
    var dateKey: String

    var startDate: Date { Date(timeIntervalSince1970: startedAt) }
    var endDate: Date? { endedAt.map { Date(timeIntervalSince1970: $0) } }
    var isOpen: Bool { endedAt == nil }

    init(
        id: String = UUID().uuidString,
        domain: String,
        pageTitle: String? = nil,
        urlSlug: String? = nil,
        browserName: String,
        startedAt: Double = Date().timeIntervalSince1970,
        endedAt: Double? = nil,
        duration: Double = 0,
        isPrivate: Bool = false,
        confidence: Double = 1.0,
        dateKey: String? = nil
    ) {
        self.id = id
        self.domain = domain
        // Redact page-level detail for private sessions
        self.pageTitle = isPrivate ? nil : pageTitle
        self.urlSlug = isPrivate ? nil : urlSlug
        self.browserName = browserName
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.duration = duration
        self.isPrivate = isPrivate
        self.confidence = confidence
        self.dateKey = dateKey ?? AppSession.makeDateKey(from: startedAt)
    }
}

// MARK: - Dashboard aggregate

struct WebsiteUsageSummary: Identifiable {
    let id: String            // domain
    let domain: String
    let totalSeconds: Double
    let visitCount: Int
    let avgConfidence: Double
    let dateKey: String
}
