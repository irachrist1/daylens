import Foundation
import GRDB

struct BrowserSession: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "browser_sessions"

    var id: String
    var browserBundleId: String
    var browserName: String
    var startedAt: Double
    var endedAt: Double?
    var activeDuration: Double
    var dateKey: String

    var startDate: Date { Date(timeIntervalSince1970: startedAt) }
    var endDate: Date? { endedAt.map { Date(timeIntervalSince1970: $0) } }
    var isOpen: Bool { endedAt == nil }

    init(
        id: String = UUID().uuidString,
        browserBundleId: String,
        browserName: String,
        startedAt: Double = Date().timeIntervalSince1970,
        endedAt: Double? = nil,
        activeDuration: Double = 0,
        dateKey: String? = nil
    ) {
        self.id = id
        self.browserBundleId = browserBundleId
        self.browserName = browserName
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.activeDuration = activeDuration
        self.dateKey = dateKey ?? AppSession.makeDateKey(from: startedAt)
    }
}

// MARK: - Known browsers

enum KnownBrowser: String, CaseIterable {
    case safari      = "com.apple.Safari"
    case chrome      = "com.google.Chrome"
    case arc         = "company.thebrowser.Browser"
    case brave       = "com.brave.Browser"
    case edge        = "com.microsoft.edgemac"
    case firefox     = "org.mozilla.firefox"
    case comet       = "com.perplexity.mac"

    var displayName: String {
        switch self {
        case .safari:  return "Safari"
        case .chrome:  return "Chrome"
        case .arc:     return "Arc"
        case .brave:   return "Brave"
        case .edge:    return "Edge"
        case .firefox: return "Firefox"
        case .comet:   return "Comet"
        }
    }

    static func from(bundleId: String) -> KnownBrowser? {
        KnownBrowser(rawValue: bundleId)
    }

    static func isBrowser(bundleId: String) -> Bool {
        KnownBrowser(rawValue: bundleId) != nil
    }
}

struct BrowserUsageSummary: Identifiable {
    let id: String           // browserBundleId
    let browserName: String
    let browserBundleId: String
    let totalSeconds: Double
    let sessionCount: Int
    let dateKey: String
}
