import AppKit
import ApplicationServices

/// Uses the Accessibility API to read the frontmost window title.
/// This provides domain attribution for browsers without extensions.
final class AccessibilityService {
    /// Returns the title of the frontmost window for the given app.
    func frontmostWindowTitle(for app: NSRunningApplication) -> String? {
        guard let windowElement = focusedWindowElement(for: app) else { return nil }

        var titleValue: AnyObject?
        let titleResult = AXUIElementCopyAttributeValue(windowElement, kAXTitleAttribute as CFString, &titleValue)
        guard titleResult == .success, let title = titleValue as? String else { return nil }

        return title
    }

    /// Returns whether the app's focused window is currently in native macOS fullscreen.
    func isFrontmostWindowFullScreen(for app: NSRunningApplication) -> Bool {
        guard let windowElement = focusedWindowElement(for: app) else { return false }

        var fullScreenValue: AnyObject?
        guard AXUIElementCopyAttributeValue(windowElement, "AXFullScreen" as CFString, &fullScreenValue) == .success else {
            return false
        }

        if let value = fullScreenValue as? Bool {
            return value
        }

        if let number = fullScreenValue as? NSNumber {
            return number.boolValue
        }

        return false
    }

    /// Attempts to extract a URL from the address bar of a browser.
    /// Works for Chrome, Arc, and some other Chromium browsers.
    func browserAddressBarURL(for app: NSRunningApplication) -> String? {
        // Try to find a text field with the URL role
        guard let windowElement = focusedWindowElement(for: app) else { return nil }
        return findURLInElement(windowElement, depth: 0, maxDepth: 5)
    }

    /// Extracts a domain from a browser window title.
    /// Most browsers format titles as "Page Title - Browser Name" or "Page Title — Domain".
    func extractDomainFromWindowTitle(_ title: String, browserBundleID: String) -> (domain: String?, pageTitle: String?) {
        // Remove browser suffix
        let browserSuffixes = ["- Google Chrome", "- Arc", "- Brave", "- Microsoft Edge", "- Safari", "— Mozilla Firefox", "- Opera", "- Vivaldi", "- Zen Browser", "— Zen Browser", "- Comet", "- Dia"]
        var cleanTitle = title
        for suffix in browserSuffixes {
            if cleanTitle.hasSuffix(suffix) {
                cleanTitle = String(cleanTitle.dropLast(suffix.count)).trimmingCharacters(in: .whitespaces)
                break
            }
        }

        // Some titles contain the domain directly
        // e.g. "YouTube" -> "youtube.com" (needs lookup)
        // But most are just page titles — return as-is for now
        return (domain: nil, pageTitle: cleanTitle.isEmpty ? nil : cleanTitle)
    }

    /// Check if accessibility permission is granted.
    static var isAccessibilityEnabled: Bool {
        AXIsProcessTrusted()
    }

    /// Prompt the user to grant accessibility permission.
    static func requestAccessibility() {
        let options = [kAXTrustedCheckOptionPrompt.takeRetainedValue(): true] as CFDictionary
        AXIsProcessTrustedWithOptions(options)
    }

    // MARK: - Private

    private func focusedWindowElement(for app: NSRunningApplication) -> AXUIElement? {
        let pid = app.processIdentifier
        let appElement = AXUIElementCreateApplication(pid)

        var focusedWindow: AnyObject?
        let result = AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &focusedWindow)
        guard result == .success,
              let focusedWindow,
              CFGetTypeID(focusedWindow) == AXUIElementGetTypeID() else { return nil }

        return unsafeBitCast(focusedWindow, to: AXUIElement.self)
    }

    private func findURLInElement(_ element: AXUIElement, depth: Int, maxDepth: Int) -> String? {
        guard depth < maxDepth else { return nil }

        var role: AnyObject?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)

        if let roleStr = role as? String, roleStr == "AXTextField" || roleStr == "AXComboBox" {
            var value: AnyObject?
            if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value) == .success,
               let urlString = value as? String,
               urlString.contains(".") && !urlString.contains(" ") {
                return urlString
            }
        }

        var children: AnyObject?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
              let childArray = children as? [AXUIElement] else {
            return nil
        }

        for child in childArray {
            if let url = findURLInElement(child, depth: depth + 1, maxDepth: maxDepth) {
                return url
            }
        }

        return nil
    }
}
