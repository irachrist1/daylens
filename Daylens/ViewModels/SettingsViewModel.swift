import Foundation
import Observation
import AppKit
import UniformTypeIdentifiers

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

    func exportData() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "daylens-export-\(ISO8601DateFormatter().string(from: Date()).prefix(10)).json"
        panel.allowedContentTypes = [.json]
        panel.canCreateDirectories = true

        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            Task { @MainActor in
                do {
                    let startDate = Calendar.current.date(byAdding: .year, value: -1, to: Date())!
                    let endDate = Calendar.current.date(byAdding: .day, value: 1, to: Date())!
                    let data = try AppDatabase.shared.exportData(from: startDate, to: endDate)
                    let jsonData = try JSONSerialization.data(withJSONObject: data, options: [.prettyPrinted, .sortedKeys])
                    try jsonData.write(to: url)
                    self.statusMessage = "Data exported successfully."
                } catch {
                    self.statusMessage = "Export failed: \(error.localizedDescription)"
                }
            }
        }
    }
}
