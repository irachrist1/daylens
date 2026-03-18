import AppKit
import Observation
import ServiceManagement

/// Manages app permissions and login item registration.
@Observable
final class PermissionManager {
    var isAccessibilityGranted: Bool = false
    var isFullDiskAccessGranted: Bool = false
    var isLoginItemEnabled: Bool = false

    init() {
        refreshPermissions()
    }

    func refreshPermissions() {
        isAccessibilityGranted = AXIsProcessTrusted()
        isFullDiskAccessGranted = checkFullDiskAccess()
        isLoginItemEnabled = checkLoginItemStatus()
    }

    // MARK: - Accessibility

    func requestAccessibility() {
        let options = [kAXTrustedCheckOptionPrompt.takeRetainedValue(): true] as CFDictionary
        AXIsProcessTrustedWithOptions(options)
        // Poll for change
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.refreshPermissions()
        }
    }

    // MARK: - Full Disk Access (for Safari history)

    func openFullDiskAccessPreferences() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles") {
            NSWorkspace.shared.open(url)
        }
    }

    private func checkFullDiskAccess() -> Bool {
        // Try to read Safari history as a probe for Full Disk Access
        let safariHistoryPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Safari/History.db")
            .path
        return FileManager.default.isReadableFile(atPath: safariHistoryPath)
    }

    // MARK: - Login Item

    func enableLoginItem() {
        do {
            try SMAppService.mainApp.register()
            isLoginItemEnabled = true
        } catch {
            print("Failed to register login item: \(error)")
        }
    }

    func disableLoginItem() {
        do {
            try SMAppService.mainApp.unregister()
            isLoginItemEnabled = false
        } catch {
            print("Failed to unregister login item: \(error)")
        }
    }

    private func checkLoginItemStatus() -> Bool {
        SMAppService.mainApp.status == .enabled
    }
}
