import Foundation

enum Constants {
    struct AIModelOption: Identifiable, Hashable {
        let id: String
        let name: String
        let shortName: String
    }

    // MARK: - Tracking Thresholds
    /// Minimum seconds an app must be frontmost to count as "used"
    static let minimumUsageDuration: TimeInterval = 1.0
    /// Maximum gap (seconds) between same-app sessions to merge them
    static let sessionMergeThreshold: TimeInterval = 8.0
    /// Seconds of inactivity before user is considered idle
    static let idleThreshold: TimeInterval = 120.0
    /// How often to poll browser history (seconds)
    static let browserHistoryPollInterval: TimeInterval = 60.0
    /// Minimum seconds on a website to count as a "visit"
    static let minimumWebsiteVisitDuration: TimeInterval = 5.0

    // MARK: - Data Retention
    /// Default data retention in days
    static let defaultRetentionDays: Int = 90

    // MARK: - AI
    static let defaultAIModel: String = "claude-sonnet-4-6"
    static let anthropicAPIBaseURL: String = "https://api.anthropic.com/v1"
    static let maxAIContextTokens: Int = 4000
    static let anthropicModels: [AIModelOption] = [
        AIModelOption(
            id: "claude-sonnet-4-6",
            name: "Claude Sonnet 4.6 (Recommended)",
            shortName: "Sonnet 4.6"
        ),
        AIModelOption(
            id: "claude-opus-4-6",
            name: "Claude Opus 4.6 (Most capable)",
            shortName: "Opus 4.6"
        ),
        AIModelOption(
            id: "claude-haiku-4-5-20251001",
            name: "Claude Haiku 4.5 (Fastest)",
            shortName: "Haiku 4.5"
        ),
    ]

    // MARK: - Browser Bundle IDs

    /// Primary (general-purpose) browsers only. Used for isBrowser flags on sessions.
    /// Does NOT include hybrid apps (Dia, Atlas) — those have their own primary category.
    static let knownBrowserBundleIDs: Set<String> = {
        Set(BrowserDefinition.allPrimary.map(\.bundleID))
    }()

    /// All browser-capable bundle IDs (primary + hybrid). Used for URL extraction decisions.
    static let browserCapableBundleIDs: Set<String> = {
        Set(BrowserDefinition.all.map(\.bundleID))
    }()

    /// Maps bundle IDs to human-readable names for all browser-capable apps.
    static let browserNames: [String: String] = {
        Dictionary(uniqueKeysWithValues: BrowserDefinition.all.map { ($0.bundleID, $0.displayName) })
    }()

    // MARK: - Browser History Paths (relative to home directory)
    /// Derived from BrowserDefinition. Firefox-based browsers use profile discovery (empty path).
    static let browserHistoryPaths: [String: String] = {
        Dictionary(uniqueKeysWithValues: BrowserDefinition.all.map { def in
            switch def.engine {
            case .firefox:
                return (def.bundleID, "") // Handled specially — needs profile discovery
            default:
                return (def.bundleID, def.historyRelativePath)
            }
        })
    }()

    // MARK: - App Categories (basic defaults)
    static let productivityBundleIDs: Set<String> = [
        "com.apple.dt.Xcode",
        "com.microsoft.VSCode",
        "com.sublimetext.4",
        "com.jetbrains.intellij",
        "com.apple.iWork.Keynote",
        "com.apple.iWork.Pages",
        "com.apple.iWork.Numbers",
        "com.microsoft.Word",
        "com.microsoft.Excel",
        "com.microsoft.Powerpoint",
        "com.tinyspeck.slackmacgap",
        "com.linear",
        "com.figma.Desktop",
        "com.notion.id",
    ]

    static let communicationBundleIDs: Set<String> = [
        "com.apple.MobileSMS",
        "com.apple.mail",
        "com.tinyspeck.slackmacgap",
        "us.zoom.xos",
        "com.microsoft.teams2",
        "com.hnc.Discord",
    ]

    // MARK: - UserDefaults Keys
    enum DefaultsKey {
        static let userName = "userName"
        static let hasCompletedOnboarding = "hasCompletedOnboarding"
        static let anthropicAPIKey = "anthropic_api_key"
        static let anthropicModel = "anthropic_model"
    }
}
