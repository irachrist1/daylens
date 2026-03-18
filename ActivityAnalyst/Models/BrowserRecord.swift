import Foundation
#if canImport(GRDB)
import GRDB
#endif

struct BrowserRecord: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var bundleIdentifier: String
    var name: String
    var extensionInstalled: Bool
    var firstSeen: Date

    init(
        id: UUID = UUID(),
        bundleIdentifier: String,
        name: String,
        extensionInstalled: Bool = false,
        firstSeen: Date = Date()
    ) {
        self.id = id
        self.bundleIdentifier = bundleIdentifier
        self.name = name
        self.extensionInstalled = extensionInstalled
        self.firstSeen = firstSeen
    }
}

#if canImport(GRDB)
extension BrowserRecord: FetchableRecord, PersistableRecord {
    static let databaseTableName = "browsers"

    enum Columns: String, ColumnExpression {
        case id, bundleIdentifier, name, extensionInstalled, firstSeen
    }
}
#endif

extension BrowserRecord {
    static let knownBrowsers: [String: String] = [
        "com.apple.Safari": "Safari",
        "com.google.Chrome": "Chrome",
        "com.brave.Browser": "Brave",
        "company.thebrowser.Browser": "Arc",
        "org.mozilla.firefox": "Firefox",
        "com.microsoft.edgemac": "Edge",
        "com.operasoftware.Opera": "Opera",
        "com.vivaldi.Vivaldi": "Vivaldi",
        "org.chromium.Chromium": "Chromium",
        "com.nickvision.user.nickvision": "Comet",
    ]

    static let chromiumBrowsers: Set<String> = [
        "com.google.Chrome",
        "com.brave.Browser",
        "company.thebrowser.Browser",
        "com.microsoft.edgemac",
        "com.operasoftware.Opera",
        "com.vivaldi.Vivaldi",
        "org.chromium.Chromium",
    ]

    static func isBrowser(_ bundleId: String) -> Bool {
        knownBrowsers.keys.contains(bundleId)
    }

    static func isChromiumBrowser(_ bundleId: String) -> Bool {
        chromiumBrowsers.contains(bundleId)
    }

    static func browserName(for bundleId: String) -> String? {
        knownBrowsers[bundleId]
    }
}
