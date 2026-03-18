import Foundation
#if canImport(AppKit)
import AppKit
import ApplicationServices
#endif

/// Manages macOS permission requests and monitors their status.
@MainActor
final class PermissionManager: ObservableObject {
    @Published var accessibilityStatus: PermissionStatus = .notDetermined
    @Published var screenRecordingStatus: PermissionStatus = .notDetermined
    @Published var automationStatus: PermissionStatus = .notDetermined

    init() {
        refreshPermissions()
    }

    func refreshPermissions() {
        #if canImport(AppKit)
        accessibilityStatus = checkAccessibility()
        #endif
    }

    // MARK: - Accessibility

    #if canImport(AppKit)
    private func checkAccessibility() -> PermissionStatus {
        let trusted = AXIsProcessTrusted()
        return trusted ? .granted : .denied
    }

    func requestAccessibility() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
        AXIsProcessTrustedWithOptions(options)

        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.refreshPermissions()
        }
    }

    func openAccessibilitySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    func openScreenRecordingSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }
    #endif

    /// Returns a list of all permissions with their current status.
    var allPermissions: [(name: String, status: PermissionStatus, description: String)] {
        [
            (
                name: "Accessibility",
                status: accessibilityStatus,
                description: "Required. Detects which window is active for accurate tracking."
            ),
            (
                name: "Screen Recording",
                status: screenRecordingStatus,
                description: "Optional. Enables window title capture for non-AX-accessible apps."
            ),
            (
                name: "Automation",
                status: automationStatus,
                description: "Optional. Queries browser tab URLs when extension is unavailable."
            ),
        ]
    }
}
