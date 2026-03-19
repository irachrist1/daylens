import Foundation

/// Groups and categorizes domains for richer browser intelligence.
enum DomainIntelligence {

    /// Categorize a domain into a high-level site group.
    /// Returns the parent service name and category when recognized.
    static func classify(domain: String) -> DomainClassification {
        let normalized = domain.lowercased()

        // Check exact matches first
        if let exact = exactDomainRules[normalized] {
            return exact
        }

        // Check suffix/contains rules
        for rule in suffixRules {
            if normalized.hasSuffix(rule.suffix) || normalized == rule.suffix.dropFirst() {
                return rule.classification
            }
        }

        return DomainClassification(
            siteGroup: nil,
            category: .uncategorized,
            confidence: .low
        )
    }

    /// Group a domain to its parent service (e.g., docs.google.com → Google).
    static func siteGroup(for domain: String) -> String? {
        classify(domain: domain).siteGroup
    }

    /// Aggregate website summaries into grouped site summaries.
    static func groupedSummaries(from websiteSummaries: [WebsiteUsageSummary]) -> [SiteGroupSummary] {
        var groups: [String: SiteGroupAccumulator] = [:]

        for site in websiteSummaries {
            let classification = classify(domain: site.domain)
            let groupKey = classification.siteGroup ?? site.domain

            if var acc = groups[groupKey] {
                acc.totalDuration += site.totalDuration
                acc.visitCount += site.visitCount
                acc.domains.insert(site.domain)
                if site.totalDuration > acc.topDomainDuration {
                    acc.topDomain = site.domain
                    acc.topDomainDuration = site.totalDuration
                    acc.topPageTitle = site.topPageTitle
                }
                groups[groupKey] = acc
            } else {
                groups[groupKey] = SiteGroupAccumulator(
                    siteGroup: groupKey,
                    totalDuration: site.totalDuration,
                    visitCount: site.visitCount,
                    domains: [site.domain],
                    topDomain: site.domain,
                    topDomainDuration: site.totalDuration,
                    topPageTitle: site.topPageTitle,
                    category: classification.category
                )
            }
        }

        return groups.values
            .map { acc in
                SiteGroupSummary(
                    siteGroup: acc.siteGroup,
                    totalDuration: acc.totalDuration,
                    visitCount: acc.visitCount,
                    domainCount: acc.domains.count,
                    topDomain: acc.topDomain,
                    topPageTitle: acc.topPageTitle,
                    category: acc.category
                )
            }
            .sorted { $0.totalDuration > $1.totalDuration }
    }

    // MARK: - Rules

    private static let exactDomainRules: [String: DomainClassification] = [
        "github.com": DomainClassification(siteGroup: "GitHub", category: .development, confidence: .high),
        "gitlab.com": DomainClassification(siteGroup: "GitLab", category: .development, confidence: .high),
        "stackoverflow.com": DomainClassification(siteGroup: "Stack Overflow", category: .development, confidence: .high),
        "npmjs.com": DomainClassification(siteGroup: "npm", category: .development, confidence: .high),
        "developer.apple.com": DomainClassification(siteGroup: "Apple Developer", category: .development, confidence: .high),
        "docs.swift.org": DomainClassification(siteGroup: "Swift Docs", category: .development, confidence: .high),

        "youtube.com": DomainClassification(siteGroup: "YouTube", category: .entertainment, confidence: .high),
        "netflix.com": DomainClassification(siteGroup: "Netflix", category: .entertainment, confidence: .high),
        "twitch.tv": DomainClassification(siteGroup: "Twitch", category: .entertainment, confidence: .high),
        "reddit.com": DomainClassification(siteGroup: "Reddit", category: .entertainment, confidence: .medium),
        "twitter.com": DomainClassification(siteGroup: "X/Twitter", category: .entertainment, confidence: .medium),
        "x.com": DomainClassification(siteGroup: "X/Twitter", category: .entertainment, confidence: .medium),

        "notion.so": DomainClassification(siteGroup: "Notion", category: .writing, confidence: .high),
        "docs.google.com": DomainClassification(siteGroup: "Google Docs", category: .writing, confidence: .high),
        "sheets.google.com": DomainClassification(siteGroup: "Google Sheets", category: .writing, confidence: .high),

        "figma.com": DomainClassification(siteGroup: "Figma", category: .design, confidence: .high),
        "dribbble.com": DomainClassification(siteGroup: "Dribbble", category: .design, confidence: .high),

        "slack.com": DomainClassification(siteGroup: "Slack", category: .communication, confidence: .high),
        "discord.com": DomainClassification(siteGroup: "Discord", category: .communication, confidence: .high),
        "mail.google.com": DomainClassification(siteGroup: "Gmail", category: .communication, confidence: .high),
        "outlook.live.com": DomainClassification(siteGroup: "Outlook", category: .communication, confidence: .high),
        "outlook.office.com": DomainClassification(siteGroup: "Outlook", category: .communication, confidence: .high),
        "teams.microsoft.com": DomainClassification(siteGroup: "Teams", category: .communication, confidence: .high),

        "linear.app": DomainClassification(siteGroup: "Linear", category: .development, confidence: .high),
        "vercel.com": DomainClassification(siteGroup: "Vercel", category: .development, confidence: .high),

        "chat.openai.com": DomainClassification(siteGroup: "ChatGPT", category: .aiTools, confidence: .high),
        "chatgpt.com": DomainClassification(siteGroup: "ChatGPT", category: .aiTools, confidence: .high),
        "claude.ai": DomainClassification(siteGroup: "Claude", category: .aiTools, confidence: .high),
        "perplexity.ai": DomainClassification(siteGroup: "Perplexity", category: .aiTools, confidence: .high),

        "google.com": DomainClassification(siteGroup: "Google", category: .research, confidence: .medium),
        "wikipedia.org": DomainClassification(siteGroup: "Wikipedia", category: .research, confidence: .high),
        "medium.com": DomainClassification(siteGroup: "Medium", category: .research, confidence: .medium),
    ]

    private struct SuffixRule {
        let suffix: String
        let classification: DomainClassification
    }

    private static let suffixRules: [SuffixRule] = [
        SuffixRule(suffix: ".github.com", classification: DomainClassification(siteGroup: "GitHub", category: .development, confidence: .high)),
        SuffixRule(suffix: ".github.io", classification: DomainClassification(siteGroup: "GitHub Pages", category: .development, confidence: .medium)),
        SuffixRule(suffix: ".gitlab.com", classification: DomainClassification(siteGroup: "GitLab", category: .development, confidence: .high)),
        SuffixRule(suffix: ".stackoverflow.com", classification: DomainClassification(siteGroup: "Stack Overflow", category: .development, confidence: .high)),
        SuffixRule(suffix: ".stackexchange.com", classification: DomainClassification(siteGroup: "Stack Exchange", category: .development, confidence: .medium)),

        SuffixRule(suffix: ".google.com", classification: DomainClassification(siteGroup: "Google", category: .research, confidence: .medium)),
        SuffixRule(suffix: ".googleapis.com", classification: DomainClassification(siteGroup: "Google", category: .research, confidence: .low)),

        SuffixRule(suffix: ".youtube.com", classification: DomainClassification(siteGroup: "YouTube", category: .entertainment, confidence: .high)),
        SuffixRule(suffix: ".reddit.com", classification: DomainClassification(siteGroup: "Reddit", category: .entertainment, confidence: .medium)),
        SuffixRule(suffix: ".twitter.com", classification: DomainClassification(siteGroup: "X/Twitter", category: .entertainment, confidence: .medium)),

        SuffixRule(suffix: ".notion.so", classification: DomainClassification(siteGroup: "Notion", category: .writing, confidence: .high)),
        SuffixRule(suffix: ".notion.site", classification: DomainClassification(siteGroup: "Notion", category: .writing, confidence: .medium)),

        SuffixRule(suffix: ".slack.com", classification: DomainClassification(siteGroup: "Slack", category: .communication, confidence: .high)),
        SuffixRule(suffix: ".discord.com", classification: DomainClassification(siteGroup: "Discord", category: .communication, confidence: .high)),

        SuffixRule(suffix: ".figma.com", classification: DomainClassification(siteGroup: "Figma", category: .design, confidence: .high)),

        SuffixRule(suffix: ".openai.com", classification: DomainClassification(siteGroup: "OpenAI", category: .aiTools, confidence: .high)),
        SuffixRule(suffix: ".anthropic.com", classification: DomainClassification(siteGroup: "Anthropic", category: .aiTools, confidence: .high)),

        SuffixRule(suffix: ".wikipedia.org", classification: DomainClassification(siteGroup: "Wikipedia", category: .research, confidence: .high)),
        SuffixRule(suffix: ".medium.com", classification: DomainClassification(siteGroup: "Medium", category: .research, confidence: .medium)),
    ]
}

// MARK: - Types

struct DomainClassification {
    let siteGroup: String?
    let category: AppCategory
    let confidence: AppClassificationConfidence
}

struct SiteGroupSummary: Identifiable {
    let siteGroup: String
    let totalDuration: TimeInterval
    let visitCount: Int
    let domainCount: Int
    let topDomain: String
    let topPageTitle: String?
    let category: AppCategory

    var id: String { siteGroup }

    var formattedDuration: String {
        let hours = Int(totalDuration) / 3600
        let minutes = (Int(totalDuration) % 3600) / 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        if minutes > 0 { return "\(minutes)m" }
        return "<1m"
    }
}

private struct SiteGroupAccumulator {
    let siteGroup: String
    var totalDuration: TimeInterval
    var visitCount: Int
    var domains: Set<String>
    var topDomain: String
    var topDomainDuration: TimeInterval
    var topPageTitle: String?
    var category: AppCategory
}
