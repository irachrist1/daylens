import Foundation
import Combine
#if canImport(AppKit)
import AppKit
import ApplicationServices
import CoreGraphics
#endif

/// Manages macOS permission requests and monitors their status.
/// Publishes real-time permission state for UI binding.
@MainActor
final class PermissionManager: ObservableObject {
    @Published var accessibilityStatus: PermissionStatus = .notDetermined
    @Published var screenRecordingStatus: PermissionStatus = .notDetermined
    @Published var automationStatuses: [String: PermissionStatus] = [:]

    private var pollTimer: Timer?

    init() {
        refreshPermissions()
    }

    func refreshPermissions() {
        #if canImport(AppKit)
        accessibilityStatus = checkAccessibility()
        screenRecordingStatus = checkScreenRecording()
        refreshAutomationStatuses()
        #endif
    }

    /// Start polling permission status (for onboarding flow when user is in System Settings).
    func startPolling() {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refreshPermissions()
            }
        }
    }

    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    /// Overall automation status: `.granted` if at least one browser is granted.
    var automationStatus: PermissionStatus {
        if automationStatuses.values.contains(.granted) { return .granted }
        if automationStatuses.isEmpty { return .notDetermined }
        return .denied
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
        startPolling()
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

    func openAutomationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: - Screen Recording

    private func checkScreenRecording() -> PermissionStatus {
        guard let windowList = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else {
            return .denied
        }
        let hasNames = windowList.contains { ($0[kCGWindowName as String] as? String) != nil }
        return hasNames ? .granted : .denied
    }

    // MARK: - Automation (per-browser)

    /// Detects which known browsers are installed on this Mac.
    func installedBrowsers() -> [(bundleId: String, name: String)] {
        BrowserRecord.knownBrowsers.compactMap { bundleId, name in
            if NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) != nil {
                return (bundleId: bundleId, name: name)
            }
            return nil
        }
        .sorted { $0.name < $1.name }
    }

    /// Triggers the macOS Automation permission dialog for a specific browser.
    /// Runs a lightweight AppleScript on a background thread that causes the system to prompt the user.
    func requestAutomationAccess(for bundleId: String) {
        let appName = automationAppName(for: bundleId)
        let source: String
        if bundleId == "com.apple.Safari" {
            source = "tell application \"\(appName)\" to return name of front window"
        } else if bundleId == "org.mozilla.firefox" {
            source = "tell application \"System Events\" to return name of first process whose bundle identifier is \"\(bundleId)\""
        } else {
            source = "tell application \"\(appName)\" to return title of active tab of front window"
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let script = NSAppleScript(source: source)
            var error: NSDictionary?
            script?.executeAndReturnError(&error)

            let wasGranted: Bool
            if let errorDict = error,
               let errorNumber = errorDict[NSAppleScript.errorNumber] as? Int {
                wasGranted = errorNumber != -1743
            } else {
                wasGranted = true
            }

            Task { @MainActor [weak self] in
                guard let self else { return }
                if wasGranted {
                    self.markAutomationGranted(for: bundleId)
                    self.automationStatuses[bundleId] = .granted
                } else {
                    self.automationStatuses[bundleId] = .denied
                }
            }
        }
    }

    private static let automationGrantedKey = "automationGrantedBrowsers"

    /// Reads persisted automation grant status. Safe to call on main thread (no AppleScript).
    func checkAutomationAccess(for bundleId: String) -> PermissionStatus {
        guard NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) != nil else {
            return .notDetermined
        }
        let granted = UserDefaults.standard.stringArray(forKey: Self.automationGrantedKey) ?? []
        return granted.contains(bundleId) ? .granted : .notDetermined
    }

    /// Persists that automation was granted for a browser (called after a successful AppleScript probe on a background thread).
    private func markAutomationGranted(for bundleId: String) {
        var granted = UserDefaults.standard.stringArray(forKey: Self.automationGrantedKey) ?? []
        if !granted.contains(bundleId) {
            granted.append(bundleId)
            UserDefaults.standard.set(granted, forKey: Self.automationGrantedKey)
        }
    }

    /// Probes automation permission on a background thread, then updates status on main.
    func probeAutomationAccess(for bundleId: String) {
        let appName = automationAppName(for: bundleId)
        let source: String
        if bundleId == "com.apple.Safari" {
            source = "tell application \"\(appName)\" to return name of front document"
        } else if bundleId == "org.mozilla.firefox" {
            return
        } else {
            source = "tell application \"\(appName)\" to return title of active tab of front window"
        }

        DispatchQueue.global(qos: .utility).async { [weak self] in
            let script = NSAppleScript(source: source)
            var error: NSDictionary?
            script?.executeAndReturnError(&error)

            let wasGranted: Bool
            if let errorDict = error,
               let errorNumber = errorDict[NSAppleScript.errorNumber] as? Int {
                wasGranted = errorNumber != -1743
            } else {
                wasGranted = true
            }

            Task { @MainActor [weak self] in
                guard let self else { return }
                if wasGranted {
                    self.markAutomationGranted(for: bundleId)
                    self.automationStatuses[bundleId] = .granted
                } else {
                    self.automationStatuses[bundleId] = .denied
                }
            }
        }
    }

    private func refreshAutomationStatuses() {
        for (bundleId, _) in installedBrowsers() {
            automationStatuses[bundleId] = checkAutomationAccess(for: bundleId)
        }
    }

    private func refreshAutomationStatus(for bundleId: String) {
        automationStatuses[bundleId] = checkAutomationAccess(for: bundleId)
    }

    /// Maps bundle IDs to the application name used in AppleScript `tell application`.
    private func automationAppName(for bundleId: String) -> String {
        switch bundleId {
        case "com.apple.Safari": return "Safari"
        case "com.google.Chrome": return "Google Chrome"
        case "com.brave.Browser": return "Brave Browser"
        case "company.thebrowser.Browser": return "Arc"
        case "com.microsoft.edgemac": return "Microsoft Edge"
        case "com.operasoftware.Opera": return "Opera"
        case "com.vivaldi.Vivaldi": return "Vivaldi"
        case "org.chromium.Chromium": return "Chromium"
        default: return BrowserRecord.browserName(for: bundleId) ?? "Unknown"
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
                description: "Optional. Queries browser tab URLs directly for accurate website tracking."
            ),
        ]
    }
}
