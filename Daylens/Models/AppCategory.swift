import Foundation
import GRDB

/// Practical categories for app usage analysis and AI grounding.
enum AppCategory: String, Codable, CaseIterable, DatabaseValueConvertible {
    case development = "Development"
    case communication = "Communication"
    case research = "Research"
    case writing = "Writing"
    case aiTools = "AI Tools"
    case design = "Design"
    case browsing = "Browsing"
    case meetings = "Meetings"
    case entertainment = "Entertainment"
    case email = "Email"
    case productivity = "Productivity"
    case social = "Social"
    case system = "System"
    case uncategorized = "Uncategorized"

    /// Categorize an app using deterministic bundle and name rules.
    static func categorize(bundleID: String, appName: String? = nil) -> AppCategory {
        classify(bundleID: bundleID, appName: appName).category
    }

    static func classify(bundleID: String, appName: String? = nil) -> AppClassification {
        let normalizedBundleID = bundleID.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedAppName = (appName ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        // 1. Exact bundle rules take highest precedence.
        //    This handles hybrid apps (Dia → AI Tools, Atlas → AI Tools),
        //    excluded apps, and well-known apps with explicit classifications.
        if let exactMatch = exactBundleRules[normalizedBundleID] {
            return exactMatch
        }

        // 2. Primary browsers — general-purpose browsers only.
        //    Hybrid apps are NOT in this set; they keep their primary category.
        if Constants.knownBrowserBundleIDs.contains(bundleID) {
            return AppClassification(
                category: .browsing,
                semanticLabel: "Web browser",
                confidence: .high,
                rule: "Known browser bundle ID"
            )
        }

        // 3. Excluded apps — look browser-like but are not browser-capable.
        if BrowserRegistry.excludedBundleIDs.contains(bundleID) {
            // Fall through to pattern rules below
        }

        if Constants.communicationBundleIDs.contains(bundleID) {
            return AppClassification(
                category: .communication,
                semanticLabel: "Messaging and collaboration",
                confidence: .high,
                rule: "Known communication bundle ID"
            )
        }

        for rule in bundlePatternRules where rule.matches(bundleID: normalizedBundleID, appName: normalizedAppName) {
            return rule.classification
        }

        for rule in appNamePatternRules where rule.matches(bundleID: normalizedBundleID, appName: normalizedAppName) {
            return rule.classification
        }

        return AppClassification(
            category: .uncategorized,
            semanticLabel: nil,
            confidence: .low,
            rule: "No deterministic rule matched"
        )
    }

    var isFocused: Bool {
        switch self {
        case .development, .research, .writing, .aiTools, .design, .productivity:
            return true
        case .communication, .email, .browsing, .meetings, .entertainment, .system, .social, .uncategorized:
            return false
        }
    }

    var legendLabel: String {
        rawValue
    }

    var icon: String {
        switch self {
        case .development:   return "chevron.left.forwardslash.chevron.right"
        case .communication: return "message.fill"
        case .research:      return "safari.fill"
        case .writing:       return "pencil"
        case .aiTools:       return "sparkles"
        case .design:        return "paintbrush.fill"
        case .browsing:      return "globe"
        case .meetings:      return "video.fill"
        case .entertainment: return "play.fill"
        case .email:         return "envelope.fill"
        case .productivity:  return "checkmark.circle.fill"
        case .social:        return "person.2.fill"
        case .system:        return "gear"
        case .uncategorized: return "questionmark"
        }
    }
}

struct AppClassification: Equatable {
    let category: AppCategory
    let semanticLabel: String?
    let confidence: AppClassificationConfidence
    let rule: String
}

enum AppClassificationConfidence: String, Equatable {
    case high = "High"
    case medium = "Medium"
    case low = "Low"

    var isHighConfidence: Bool {
        self == .high
    }
}

private struct AppClassificationRule {
    let category: AppCategory
    let semanticLabel: String?
    let confidence: AppClassificationConfidence
    let rule: String
    let bundlePatterns: [String]
    let appNamePatterns: [String]

    var classification: AppClassification {
        AppClassification(
            category: category,
            semanticLabel: semanticLabel,
            confidence: confidence,
            rule: rule
        )
    }

    func matches(bundleID: String, appName: String) -> Bool {
        bundlePatterns.contains(where: bundleID.contains) || appNamePatterns.contains(where: appName.contains)
    }
}

private extension AppCategory {
    static let exactBundleRules: [String: AppClassification] = [
        "com.apple.dt.xcode": AppClassification(
            category: .development,
            semanticLabel: "Apple IDE",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.microsoft.vscode": AppClassification(
            category: .development,
            semanticLabel: "Code editor",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.github.githubclient": AppClassification(
            category: .development,
            semanticLabel: "Git client",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.getpostman.postman": AppClassification(
            category: .development,
            semanticLabel: "API client",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.tableplus.tableplus": AppClassification(
            category: .development,
            semanticLabel: "Database client",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.tinyspeck.slackmacgap": AppClassification(
            category: .communication,
            semanticLabel: "Team chat",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.hnc.discord": AppClassification(
            category: .communication,
            semanticLabel: "Community chat",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.apple.mail": AppClassification(
            category: .email,
            semanticLabel: "Email",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.microsoft.outlook": AppClassification(
            category: .email,
            semanticLabel: "Email client",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.apple.iCal": AppClassification(
            category: .productivity,
            semanticLabel: "Calendar",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.apple.reminders": AppClassification(
            category: .productivity,
            semanticLabel: "Task manager",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.culturedcode.ThingsMac": AppClassification(
            category: .productivity,
            semanticLabel: "Task manager",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.omnigroup.OmniFocus3": AppClassification(
            category: .productivity,
            semanticLabel: "Task manager",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.todoist.mac.Todoist": AppClassification(
            category: .productivity,
            semanticLabel: "Task manager",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.linear.linear": AppClassification(
            category: .productivity,
            semanticLabel: "Project management",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.apple.mobilesms": AppClassification(
            category: .communication,
            semanticLabel: "Messages",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "us.zoom.xos": AppClassification(
            category: .meetings,
            semanticLabel: "Video meeting client",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.microsoft.teams2": AppClassification(
            category: .meetings,
            semanticLabel: "Video meetings and calls",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.figma.desktop": AppClassification(
            category: .design,
            semanticLabel: "Design workspace",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "company.thebrowser.browser": AppClassification(
            category: .browsing,
            semanticLabel: "Web browser",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.anthropic.claudefordesktop": AppClassification(
            category: .aiTools,
            semanticLabel: "AI assistant",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.openai.chat": AppClassification(
            category: .aiTools,
            semanticLabel: "AI assistant",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "company.thebrowser.dia": AppClassification(
            category: .aiTools,
            semanticLabel: "AI browser assistant",
            confidence: .high,
            rule: "Exact bundle match — not a general-purpose browser"
        ),
        "ai.perplexity.mac": AppClassification(
            category: .aiTools,
            semanticLabel: "AI search assistant",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "ai.perplexity.comet": AppClassification(
            category: .browsing,
            semanticLabel: "AI-powered web browser",
            confidence: .high,
            rule: "Exact bundle match — Perplexity browser"
        ),
        "app.zen-browser.zen": AppClassification(
            category: .browsing,
            semanticLabel: "Web browser",
            confidence: .high,
            rule: "Exact bundle match — Firefox-based browser"
        ),
        "com.blackboxai.desktopapp": AppClassification(
            category: .aiTools,
            semanticLabel: "AI code assistant",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.openai.atlas": AppClassification(
            category: .aiTools,
            semanticLabel: "AI-powered browser",
            confidence: .high,
            rule: "Exact bundle match — hybrid: browser-capable but AI-primary"
        ),
        "notion.id": AppClassification(
            category: .writing,
            semanticLabel: "Docs and notes workspace",
            confidence: .medium,
            rule: "Exact bundle match"
        ),
        "md.obsidian": AppClassification(
            category: .research,
            semanticLabel: "Knowledge base",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "org.zotero.zotero": AppClassification(
            category: .research,
            semanticLabel: "Research library",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.apple.iwork.pages": AppClassification(
            category: .writing,
            semanticLabel: "Document editor",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.microsoft.word": AppClassification(
            category: .writing,
            semanticLabel: "Document editor",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.ulyssesapp.mac": AppClassification(
            category: .writing,
            semanticLabel: "Writing studio",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "net.shinyfrog.bear": AppClassification(
            category: .writing,
            semanticLabel: "Notes and writing",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.apple.finder": AppClassification(
            category: .system,
            semanticLabel: "File management",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.apple.systempreferences": AppClassification(
            category: .system,
            semanticLabel: "System settings",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.apple.preview": AppClassification(
            category: .research,
            semanticLabel: "Document reader",
            confidence: .medium,
            rule: "Exact bundle match"
        ),
        "com.spotify.client": AppClassification(
            category: .entertainment,
            semanticLabel: "Music streaming",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.apple.music": AppClassification(
            category: .entertainment,
            semanticLabel: "Music streaming",
            confidence: .high,
            rule: "Exact bundle match"
        ),
        "com.apple.tv": AppClassification(
            category: .entertainment,
            semanticLabel: "Video streaming",
            confidence: .high,
            rule: "Exact bundle match"
        ),
    ]

    static let bundlePatternRules: [AppClassificationRule] = [
        AppClassificationRule(
            category: .development,
            semanticLabel: "Terminal and shell",
            confidence: .high,
            rule: "Bundle pattern match",
            bundlePatterns: ["terminal", "iterm", "warp", "tmux", "ssh", "bbedit", "intellij", "webstorm", "pycharm", "datagrip", "rubymine", "goland", "sublime", "nova", "fork", "tower", "github", "postman", "insomnia", "tableplus", "sequel", "proxyman", "charles", "wireshark", "cursor", "windsurf"],
            appNamePatterns: []
        ),
        AppClassificationRule(
            category: .aiTools,
            semanticLabel: "AI assistant",
            confidence: .medium,
            rule: "Bundle pattern match",
            bundlePatterns: ["anthropic", "openai", "chatgpt", "claude", "perplexity", "poe"],
            appNamePatterns: []
        ),
        AppClassificationRule(
            category: .design,
            semanticLabel: "Design tool",
            confidence: .high,
            rule: "Bundle pattern match",
            bundlePatterns: ["figma", "sketch", "pixelmator", "affinity", "adobe", "canva", "framer", "principle", "zeplin"],
            appNamePatterns: []
        ),
        AppClassificationRule(
            category: .research,
            semanticLabel: "Research and reading",
            confidence: .medium,
            rule: "Bundle pattern match",
            bundlePatterns: ["zotero", "reader", "readwise", "obsidian", "devonthink", "pdfexpert"],
            appNamePatterns: []
        ),
        AppClassificationRule(
            category: .writing,
            semanticLabel: "Notes and documents",
            confidence: .medium,
            rule: "Bundle pattern match",
            bundlePatterns: ["ulysses", "bear", "iawriter", "scrivener", "notion", "pages", "word"],
            appNamePatterns: []
        ),
        AppClassificationRule(
            category: .meetings,
            semanticLabel: "Video meetings",
            confidence: .medium,
            rule: "Bundle pattern match",
            bundlePatterns: ["zoom", "teams", "meet", "webex"],
            appNamePatterns: []
        ),
        AppClassificationRule(
            category: .entertainment,
            semanticLabel: "Media or games",
            confidence: .high,
            rule: "Bundle pattern match",
            bundlePatterns: ["spotify", "music", "netflix", "youtube", "vlc", "mpv", "infuse", "plex", "steam", "epic", "gamepass"],
            appNamePatterns: []
        ),
        AppClassificationRule(
            category: .email,
            semanticLabel: "Email client",
            confidence: .medium,
            rule: "Bundle pattern match",
            bundlePatterns: ["mail", "outlook", "mimestream", "airmail", "spark"],
            appNamePatterns: []
        ),
        AppClassificationRule(
            category: .productivity,
            semanticLabel: "Task and project management",
            confidence: .medium,
            rule: "Bundle pattern match",
            bundlePatterns: ["things", "omnifocus", "todoist", "ticktick", "asana", "linear", "notion", "reminders", "ical", "fantastical", "busycal"],
            appNamePatterns: []
        ),
        AppClassificationRule(
            category: .social,
            semanticLabel: "Social media",
            confidence: .medium,
            rule: "Bundle pattern match",
            bundlePatterns: ["twitter", "tweetbot", "twitterrific", "instagram", "facebook", "linkedin", "tiktok", "mastodon", "ivory", "tapbots"],
            appNamePatterns: []
        ),
        AppClassificationRule(
            category: .system,
            semanticLabel: "System utility",
            confidence: .medium,
            rule: "Bundle pattern match",
            bundlePatterns: ["finder", "system", "utility", "calculator", "calendar", "reminders", "activity.monitor", "keychain"],
            appNamePatterns: []
        ),
    ]

    static let appNamePatternRules: [AppClassificationRule] = [
        AppClassificationRule(
            category: .development,
            semanticLabel: "Code editor",
            confidence: .medium,
            rule: "App name pattern match",
            bundlePatterns: [],
            appNamePatterns: ["xcode", "visual studio code", "cursor", "windsurf", "terminal", "iterm", "warp", "github desktop", "postman", "tableplus"]
        ),
        AppClassificationRule(
            category: .aiTools,
            semanticLabel: "AI assistant",
            confidence: .medium,
            rule: "App name pattern match",
            bundlePatterns: [],
            appNamePatterns: ["claude", "chatgpt", "perplexity", "poe"]
        ),
        AppClassificationRule(
            category: .communication,
            semanticLabel: "Team communication",
            confidence: .medium,
            rule: "App name pattern match",
            bundlePatterns: [],
            appNamePatterns: ["slack", "discord", "messages", "mail"]
        ),
        AppClassificationRule(
            category: .meetings,
            semanticLabel: "Meeting client",
            confidence: .medium,
            rule: "App name pattern match",
            bundlePatterns: [],
            appNamePatterns: ["zoom", "teams", "meet", "webex"]
        ),
        AppClassificationRule(
            category: .writing,
            semanticLabel: "Writing workspace",
            confidence: .medium,
            rule: "App name pattern match",
            bundlePatterns: [],
            appNamePatterns: ["notion", "ulysses", "bear", "pages", "word", "ia writer", "scrivener"]
        ),
        AppClassificationRule(
            category: .research,
            semanticLabel: "Knowledge and reading",
            confidence: .medium,
            rule: "App name pattern match",
            bundlePatterns: [],
            appNamePatterns: ["obsidian", "zotero", "reader", "readwise", "preview"]
        ),
        AppClassificationRule(
            category: .design,
            semanticLabel: "Design tool",
            confidence: .medium,
            rule: "App name pattern match",
            bundlePatterns: [],
            appNamePatterns: ["figma", "sketch", "framer", "canva"]
        ),
        AppClassificationRule(
            category: .entertainment,
            semanticLabel: "Media or games",
            confidence: .medium,
            rule: "App name pattern match",
            bundlePatterns: [],
            appNamePatterns: ["spotify", "music", "steam", "vlc", "netflix"]
        ),
        AppClassificationRule(
            category: .email,
            semanticLabel: "Email client",
            confidence: .medium,
            rule: "App name pattern match",
            bundlePatterns: [],
            appNamePatterns: ["mail", "outlook", "mimestream", "airmail", "spark"]
        ),
        AppClassificationRule(
            category: .productivity,
            semanticLabel: "Task manager",
            confidence: .medium,
            rule: "App name pattern match",
            bundlePatterns: [],
            appNamePatterns: ["things", "omnifocus", "todoist", "reminders", "calendar", "fantastical", "linear", "asana", "jira"]
        ),
        AppClassificationRule(
            category: .social,
            semanticLabel: "Social media",
            confidence: .medium,
            rule: "App name pattern match",
            bundlePatterns: [],
            appNamePatterns: ["twitter", "instagram", "facebook", "linkedin", "tiktok", "mastodon", "ivory"]
        ),
    ]
}
