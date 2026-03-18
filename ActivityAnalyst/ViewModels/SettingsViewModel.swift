import Foundation
import SwiftUI

/// ViewModel for the Settings view: preferences, permissions, and data management.
@MainActor
final class SettingsViewModel: ObservableObject {
    // MARK: - Published State

    @Published var preferences: TrackingPreferences
    @Published private(set) var permissions: [(name: String, status: PermissionStatus, description: String)] = []
    @Published private(set) var browserIntegrations: [BrowserRecord] = []

    // MARK: - Dependencies

    private let store: ActivityStore

    // MARK: - Init

    convenience init() {
        self.init(store: ServiceContainer.shared.store!)
    }

    init(store: ActivityStore) {
        self.store = store
        self.preferences = Self.loadPreferences()
        loadPermissions()
        loadBrowserIntegrations()
    }

    // MARK: - Public Methods

    /// Save preferences to UserDefaults.
    func savePreferences() {
        if let data = try? JSONEncoder().encode(preferences) {
            UserDefaults.standard.set(data, forKey: AppConstants.UserDefaultsKeys.trackingPreferences)
        }
    }

    /// Request a specific permission (placeholder for system permission APIs).
    func requestPermission(_ name: String) {
        // Placeholder: wire to Accessibility/Screen Recording permission APIs.
        loadPermissions()
    }

    /// Export all data.
    func exportData() {
        Task {
            do {
                let data = try await store.exportAllData()
                // Caller can handle file save; data is available for export.
                _ = data
            } catch {
                // Propagate error to UI
            }
        }
    }

    /// Delete all stored data.
    func deleteAllData() {
        Task {
            do {
                try await store.deleteAllData()
            } catch {
                // Propagate error to UI
            }
        }
    }

    // MARK: - Private Helpers

    private static func loadPreferences() -> TrackingPreferences {
        guard let data = UserDefaults.standard.data(forKey: AppConstants.UserDefaultsKeys.trackingPreferences),
              let prefs = try? JSONDecoder().decode(TrackingPreferences.self, from: data) else {
            return TrackingPreferences()
        }
        return prefs
    }

    private func loadPermissions() {
        // Placeholder: wire to actual permission checks (Accessibility, Screen Recording, etc.).
        permissions = [
            ("Accessibility", .notDetermined, "Required to detect active app and window focus"),
            ("Screen Recording", .notDetermined, "Optional for enhanced window title capture"),
        ]
    }

    private func loadBrowserIntegrations() {
        Task {
            do {
                browserIntegrations = try await store.fetchAllBrowsers()
            } catch {
                browserIntegrations = []
            }
        }
    }
}
