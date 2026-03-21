import AppKit
import Observation
import OSLog
import ServiceManagement

/// Manages app permissions and login item registration.
@Observable
final class PermissionManager {
    private let logger = Logger(subsystem: "com.daylens.app", category: "Permissions")

    var isAccessibilityGranted: Bool = false
    var isFullDiskAccessGranted: Bool = false
    var isLoginItemEnabled: Bool = false

    private var pollTimer: Timer?

    init() {
        refreshPermissions()
    }

    deinit {
        stopPolling()
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
        startPolling()
    }

    /// Begin periodic polling for accessibility permission changes.
    /// Used while the permission step is visible so the UI always converges.
    func startPolling() {
        guard pollTimer == nil else { return }
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.refreshPermissions()
            if self.isAccessibilityGranted {
                self.stopPolling()
            }
        }
    }

    /// Stop periodic polling. Call when leaving the permission screen or after granted.
    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
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
            logger.error("Failed to register login item: \(error.localizedDescription, privacy: .private)")
        }
    }

    func disableLoginItem() {
        do {
            try SMAppService.mainApp.unregister()
            isLoginItemEnabled = false
        } catch {
            logger.error("Failed to unregister login item: \(error.localizedDescription, privacy: .private)")
        }
    }

    private func checkLoginItemStatus() -> Bool {
        SMAppService.mainApp.status == .enabled
    }
}
