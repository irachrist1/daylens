import Foundation
import Observation

@Observable
final class SettingsViewModel {
    var apiKey: String = ""
    var selectedModel: String = Constants.defaultAIModel
    var retentionDays: Int = Constants.defaultRetentionDays
    var isAPIKeyVisible: Bool = false
    var statusMessage: String?

    let availableModels = [
        ("claude-sonnet-4-6", "Claude Sonnet 4.6 (Recommended)"),
        ("claude-opus-4-6", "Claude Opus 4.6 (Most capable)"),
        ("claude-haiku-4-5-20251001", "Claude Haiku 4.5 (Fastest)"),
    ]

    func loadSettings(aiService: AIService) {
        if let existingKey = KeychainHelper.read(
            service: Constants.keychainServiceName,
            account: Constants.anthropicAPIKeyAccount
        ) {
            apiKey = existingKey
        }
    }

    func saveAPIKey(aiService: AIService) {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            aiService.removeAPIKey()
            statusMessage = "API key removed."
        } else {
            aiService.setAPIKey(trimmed)
            statusMessage = "API key saved securely."
        }
    }

    func clearAllData() {
        try? AppDatabase.shared.deleteAllData()
        statusMessage = "All data deleted."
    }

    func applyRetention() {
        try? AppDatabase.shared.deleteDataOlderThan(days: retentionDays)
        statusMessage = "Data older than \(retentionDays) days has been cleaned up."
    }
}
