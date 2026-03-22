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

    let availableModels = Constants.anthropicModels.map { ($0.id, $0.name) }

    func loadSettings(aiService: AIService) {
        apiKey = aiService.currentAPIKey() ?? ""
        selectedModel = aiService.model
    }

    func saveAPIKey(aiService: AIService) {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            statusMessage = aiService.removeAPIKey() ? "API key removed." : "Couldn't remove the API key."
        } else {
            let saved = aiService.setAPIKey(trimmed)
            statusMessage = saved ? "API key saved." : "Couldn't save the API key."

            // Upload to Convex so the web companion can use it for AI chat
            if saved, SyncUploader.shared.isLinked, let convexUrl = SyncUploader.shared.convexUrl {
                Task {
                    do {
                        try await WorkspaceLinker().uploadApiKey(apiKey: trimmed, convexSiteUrl: convexUrl)
                    } catch {
                        // Non-critical — local key still works
                    }
                }
            }
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
                    let export = try await Task.detached(priority: .userInitiated) { () -> Data in
                        let startDate = Calendar.current.date(byAdding: .year, value: -1, to: Date())!
                        let endDate = Calendar.current.date(byAdding: .day, value: 1, to: Date())!
                        let data = try AppDatabase.shared.exportData(from: startDate, to: endDate)
                        return try JSONSerialization.data(withJSONObject: data, options: [.prettyPrinted, .sortedKeys])
                    }.value
                    try export.write(to: url, options: .atomic)
                    self.statusMessage = "Data exported successfully."
                } catch {
                    self.statusMessage = "Export failed: \(error.localizedDescription)"
                }
            }
        }
    }
}
