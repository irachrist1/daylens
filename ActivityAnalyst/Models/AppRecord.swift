import Foundation
#if canImport(GRDB)
import GRDB
#endif

struct AppRecord: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var bundleIdentifier: String
    var name: String
    var category: ActivityCategory
    var isBlocked: Bool
    var firstSeen: Date
    var iconData: Data?

    init(
        id: UUID = UUID(),
        bundleIdentifier: String,
        name: String,
        category: ActivityCategory = .uncategorized,
        isBlocked: Bool = false,
        firstSeen: Date = Date(),
        iconData: Data? = nil
    ) {
        self.id = id
        self.bundleIdentifier = bundleIdentifier
        self.name = name
        self.category = category
        self.isBlocked = isBlocked
        self.firstSeen = firstSeen
        self.iconData = iconData
    }
}

#if canImport(GRDB)
extension AppRecord: FetchableRecord, PersistableRecord {
    static let databaseTableName = "apps"

    enum Columns: String, ColumnExpression {
        case id, bundleIdentifier, name, category, isBlocked, firstSeen, iconData
    }
}
#endif

extension AppRecord {
    static let knownCategories: [String: ActivityCategory] = [
        "com.apple.Xcode": .development,
        "com.apple.dt.Xcode": .development,
        "com.microsoft.VSCode": .development,
        "com.sublimetext.4": .development,
        "com.apple.Terminal": .development,
        "com.googlecode.iterm2": .development,

        "com.apple.mail": .communication,
        "com.microsoft.Outlook": .communication,
        "com.tinyspeck.slackmacgap": .communication,
        "com.hnc.Discord": .communication,
        "us.zoom.xos": .communication,
        "com.apple.MobileSMS": .communication,
        "com.microsoft.teams2": .communication,

        "com.apple.Safari": .reference,
        "com.google.Chrome": .reference,
        "com.brave.Browser": .reference,
        "company.thebrowser.Browser": .reference,
        "org.mozilla.firefox": .reference,

        "com.apple.finder": .utilities,
        "com.apple.systempreferences": .utilities,
        "com.apple.ActivityMonitor": .utilities,

        "com.apple.iWork.Pages": .writing,
        "com.apple.iWork.Numbers": .productivity,
        "com.apple.iWork.Keynote": .productivity,
        "com.microsoft.Word": .writing,
        "com.microsoft.Excel": .productivity,
        "com.microsoft.Powerpoint": .productivity,
        "md.obsidian": .writing,
        "com.apple.Notes": .writing,

        "com.figma.Desktop": .design,
        "com.bohemiancoding.sketch3": .design,
        "com.adobe.Photoshop": .design,
        "com.adobe.illustrator": .design,

        "com.apple.Music": .entertainment,
        "com.spotify.client": .entertainment,
        "com.apple.TV": .entertainment,

        "com.apple.Photos": .entertainment,
        "com.apple.Preview": .utilities,
        "com.apple.calculator": .utilities,
    ]

    static func inferCategory(for bundleId: String) -> ActivityCategory {
        knownCategories[bundleId] ?? .uncategorized
    }
}
