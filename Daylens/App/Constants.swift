import Foundation

enum Constants {
    // MARK: - Tracking Thresholds
    /// Minimum seconds an app must be frontmost to count as "used"
    static let minimumUsageDuration: TimeInterval = 5.0
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

    // MARK: - Browser Bundle IDs
    static let knownBrowserBundleIDs: Set<String> = [
        "com.apple.Safari",
        "com.google.Chrome",
        "company.thebrowser.Browser",    // Arc
        "com.brave.Browser",
        "com.microsoft.edgemac",
        "org.mozilla.firefox",
        "com.operasoftware.Opera",
        "com.vivaldi.Vivaldi",
        "com.nickvision.nicegram",
        "org.chromium.Chromium",
    ]

    /// Maps bundle IDs to human-readable browser names
    static let browserNames: [String: String] = [
        "com.apple.Safari": "Safari",
        "com.google.Chrome": "Chrome",
        "company.thebrowser.Browser": "Arc",
        "com.brave.Browser": "Brave",
        "com.microsoft.edgemac": "Edge",
        "org.mozilla.firefox": "Firefox",
        "com.operasoftware.Opera": "Opera",
        "com.vivaldi.Vivaldi": "Vivaldi",
        "org.chromium.Chromium": "Chromium",
    ]

    // MARK: - Browser History Paths (relative to home directory)
    static let browserHistoryPaths: [String: String] = [
        "com.google.Chrome": "Library/Application Support/Google/Chrome/Default/History",
        "company.thebrowser.Browser": "Library/Application Support/Arc/User Data/Default/History",
        "com.brave.Browser": "Library/Application Support/BraveSoftware/Brave-Browser/Default/History",
        "com.microsoft.edgemac": "Library/Application Support/Microsoft Edge/Default/History",
        "com.apple.Safari": "Library/Safari/History.db",
        "org.mozilla.firefox": "", // Handled specially — needs profile discovery
    ]

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

    // MARK: - Keychain
    static let keychainServiceName = "com.daylens.api-keys"
    static let anthropicAPIKeyAccount = "anthropic-api-key"
}
