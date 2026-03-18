import Foundation
#if canImport(GRDB)
import GRDB
#endif

struct WebsiteRecord: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var domain: String
    var category: ActivityCategory
    var isBlocked: Bool
    var firstSeen: Date

    init(
        id: UUID = UUID(),
        domain: String,
        category: ActivityCategory = .uncategorized,
        isBlocked: Bool = false,
        firstSeen: Date = Date()
    ) {
        self.id = id
        self.domain = domain
        self.category = category
        self.isBlocked = isBlocked
        self.firstSeen = firstSeen
    }
}

#if canImport(GRDB)
extension WebsiteRecord: FetchableRecord, PersistableRecord {
    static let databaseTableName = "websites"

    enum Columns: String, ColumnExpression {
        case id, domain, category, isBlocked, firstSeen
    }
}
#endif

extension WebsiteRecord {
    static let knownDomainCategories: [String: ActivityCategory] = [
        "github.com": .development,
        "gitlab.com": .development,
        "stackoverflow.com": .development,
        "developer.apple.com": .development,
        "docs.swift.org": .development,

        "youtube.com": .entertainment,
        "netflix.com": .entertainment,
        "twitch.tv": .entertainment,
        "spotify.com": .entertainment,

        "twitter.com": .social,
        "x.com": .social,
        "facebook.com": .social,
        "instagram.com": .social,
        "reddit.com": .social,
        "linkedin.com": .social,
        "threads.net": .social,
        "mastodon.social": .social,

        "slack.com": .communication,
        "discord.com": .communication,
        "teams.microsoft.com": .communication,
        "mail.google.com": .communication,
        "outlook.live.com": .communication,

        "docs.google.com": .productivity,
        "sheets.google.com": .productivity,
        "notion.so": .productivity,
        "linear.app": .productivity,
        "asana.com": .productivity,
        "trello.com": .productivity,
        "figma.com": .design,

        "nytimes.com": .news,
        "bbc.com": .news,
        "news.ycombinator.com": .news,
        "theverge.com": .news,
        "arstechnica.com": .news,

        "amazon.com": .shopping,
        "ebay.com": .shopping,

        "wikipedia.org": .reference,
        "medium.com": .reference,
        "arxiv.org": .education,
        "coursera.org": .education,

        "chase.com": .finance,
        "bankofamerica.com": .finance,
    ]

    static func inferCategory(for domain: String) -> ActivityCategory {
        let normalizedDomain = domain
            .replacingOccurrences(of: "www.", with: "")
            .lowercased()

        if let category = knownDomainCategories[normalizedDomain] {
            return category
        }

        for (knownDomain, category) in knownDomainCategories {
            if normalizedDomain.hasSuffix(".\(knownDomain)") {
                return category
            }
        }

        return .uncategorized
    }

    static func extractDomain(from urlString: String) -> String? {
        guard let url = URL(string: urlString),
              let host = url.host else {
            return nil
        }
        return host
            .replacingOccurrences(of: "www.", with: "")
            .lowercased()
    }
}
