import Foundation
import SwiftUI

/// ViewModel for the Settings view: preferences, permissions, and data management.
@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var preferences: TrackingPreferences
    @Published private(set) var permissions: [(name: String, status: PermissionStatus, description: String)] = []
    @Published private(set) var browserIntegrations: [BrowserRecord] = []
    @Published var apiKey: String = ""
    @Published var exportMessage: String?

    private let store: ActivityStore?
    private let permManager: PermissionManager

    convenience init() {
        self.init(store: ServiceContainer.shared.store, permManager: ServiceContainer.shared.permissionManager)
    }

    init(store: ActivityStore?, permManager: PermissionManager) {
        self.store = store
        self.permManager = permManager
        self.preferences = Self.loadPreferences()
        self.apiKey = UserDefaults.standard.string(forKey: "anthropic_api_key") ?? ""
        loadPermissions()
        loadBrowserIntegrations()
    }

    func savePreferences() {
        if let data = try? JSONEncoder().encode(preferences) {
            UserDefaults.standard.set(data, forKey: AppConstants.UserDefaultsKeys.trackingPreferences)
        }
    }

    func saveAPIKey() {
        UserDefaults.standard.set(apiKey, forKey: "anthropic_api_key")
        NotificationCenter.default.post(name: AppConstants.NotificationNames.apiKeyChanged, object: nil)
    }

    func requestPermission(_ name: String) {
        switch name {
        case "Accessibility":
            #if canImport(AppKit)
            permManager.requestAccessibility()
            #endif
        case "Screen Recording":
            #if canImport(AppKit)
            permManager.openScreenRecordingSettings()
            #endif
        case "Automation":
            #if canImport(AppKit)
            permManager.openAutomationSettings()
            #endif
        default:
            break
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.loadPermissions()
        }
    }

    func exportData() {
        guard let store = store else { return }
        Task {
            do {
                #if canImport(GRDB)
                let fileURL = try await DataExporter.exportToJSON(store: store)
                #if canImport(AppKit)
                _ = await DataExporter.presentSavePanel(for: fileURL)
                #endif
                exportMessage = "Data exported successfully."
                #endif
            } catch {
                exportMessage = "Export failed: \(error.localizedDescription)"
            }
        }
    }

    func deleteAllData() {
        guard let store = store else { return }
        Task {
            do {
                try await store.deleteAllData()
                exportMessage = "All data deleted."
            } catch {
                exportMessage = "Delete failed: \(error.localizedDescription)"
            }
        }
    }

    func loadPermissions() {
        permManager.refreshPermissions()
        permissions = permManager.allPermissions
    }

    private static func loadPreferences() -> TrackingPreferences {
        guard let data = UserDefaults.standard.data(forKey: AppConstants.UserDefaultsKeys.trackingPreferences),
              let prefs = try? JSONDecoder().decode(TrackingPreferences.self, from: data) else {
            return TrackingPreferences()
        }
        return prefs
    }

    private func loadBrowserIntegrations() {
        guard let store = store else { return }
        Task {
            do {
                browserIntegrations = try await store.fetchAllBrowsers()
            } catch {
                browserIntegrations = []
            }
        }
    }
}
