import Foundation
import GRDB

/// Single-row key-value settings table.
struct UserSettingRow: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "user_settings"

    var key: String
    var value: String
}

// MARK: - Typed settings wrapper

enum AIModel: String, CaseIterable, Codable {
    case sonnet = "claude-sonnet-4-6"
    case opus   = "claude-opus-4-6"
    case haiku  = "claude-haiku-4-5-20251001"

    var displayName: String {
        switch self {
        case .sonnet: return "Claude Sonnet (Recommended)"
        case .opus:   return "Claude Opus (More thorough)"
        case .haiku:  return "Claude Haiku (Faster)"
        }
    }
}

enum RetentionPeriod: String, CaseIterable {
    case sevenDays    = "7"
    case thirtyDays   = "30"
    case ninetyDays   = "90"
    case forever      = "forever"

    var displayName: String {
        switch self {
        case .sevenDays:   return "7 days"
        case .thirtyDays:  return "30 days"
        case .ninetyDays:  return "90 days"
        case .forever:     return "Keep forever"
        }
    }
}

enum PrivateBrowsingBehavior: String, CaseIterable {
    case trackNothing   = "nothing"
    case trackTimeOnly  = "time_only"

    var displayName: String {
        switch self {
        case .trackNothing:  return "Don't track anything"
        case .trackTimeOnly: return "Track browser time only (no pages)"
        }
    }
}

@Observable
final class UserSettings {
    // Tracking
    var isTrackingPaused: Bool = false
    var idleGraceSeconds: Double = 120
    var minimumSessionSeconds: Double = 5
    var mergeSwitchGapSeconds: Double = 8

    // AI
    var anthropicApiKey: String = ""
    var selectedAIModel: AIModel = .sonnet

    // Privacy
    var privateBrowsingBehavior: PrivateBrowsingBehavior = .trackTimeOnly
    var retentionPeriod: RetentionPeriod = .ninetyDays

    // Onboarding
    var hasCompletedOnboarding: Bool = false
    var hasGrantedAccessibility: Bool = false

    // Extension status
    var chromiumExtensionActive: Bool = false
    var safariExtensionActive: Bool = false

    // Keys
    private enum Keys {
        static let isTrackingPaused = "isTrackingPaused"
        static let idleGraceSeconds = "idleGraceSeconds"
        static let minimumSessionSeconds = "minimumSessionSeconds"
        static let mergeSwitchGapSeconds = "mergeSwitchGapSeconds"
        static let anthropicApiKey = "anthropicApiKey"
        static let selectedAIModel = "selectedAIModel"
        static let privateBrowsingBehavior = "privateBrowsingBehavior"
        static let retentionPeriod = "retentionPeriod"
        static let hasCompletedOnboarding = "hasCompletedOnboarding"
        static let hasGrantedAccessibility = "hasGrantedAccessibility"
    }

    func load(from rows: [UserSettingRow]) {
        let map = Dictionary(uniqueKeysWithValues: rows.map { ($0.key, $0.value) })

        isTrackingPaused = map[Keys.isTrackingPaused] == "true"
        idleGraceSeconds = map[Keys.idleGraceSeconds].flatMap(Double.init) ?? 120
        minimumSessionSeconds = map[Keys.minimumSessionSeconds].flatMap(Double.init) ?? 5
        mergeSwitchGapSeconds = map[Keys.mergeSwitchGapSeconds].flatMap(Double.init) ?? 8
        anthropicApiKey = map[Keys.anthropicApiKey] ?? ""
        selectedAIModel = map[Keys.selectedAIModel].flatMap(AIModel.init) ?? .sonnet
        privateBrowsingBehavior = map[Keys.privateBrowsingBehavior].flatMap(PrivateBrowsingBehavior.init) ?? .trackTimeOnly
        retentionPeriod = map[Keys.retentionPeriod].flatMap(RetentionPeriod.init) ?? .ninetyDays
        hasCompletedOnboarding = map[Keys.hasCompletedOnboarding] == "true"
        hasGrantedAccessibility = map[Keys.hasGrantedAccessibility] == "true"
    }

    func toRows() -> [UserSettingRow] {
        [
            UserSettingRow(key: Keys.isTrackingPaused, value: isTrackingPaused ? "true" : "false"),
            UserSettingRow(key: Keys.idleGraceSeconds, value: String(idleGraceSeconds)),
            UserSettingRow(key: Keys.minimumSessionSeconds, value: String(minimumSessionSeconds)),
            UserSettingRow(key: Keys.mergeSwitchGapSeconds, value: String(mergeSwitchGapSeconds)),
            UserSettingRow(key: Keys.anthropicApiKey, value: anthropicApiKey),
            UserSettingRow(key: Keys.selectedAIModel, value: selectedAIModel.rawValue),
            UserSettingRow(key: Keys.privateBrowsingBehavior, value: privateBrowsingBehavior.rawValue),
            UserSettingRow(key: Keys.retentionPeriod, value: retentionPeriod.rawValue),
            UserSettingRow(key: Keys.hasCompletedOnboarding, value: hasCompletedOnboarding ? "true" : "false"),
            UserSettingRow(key: Keys.hasGrantedAccessibility, value: hasGrantedAccessibility ? "true" : "false")
        ]
    }
}
