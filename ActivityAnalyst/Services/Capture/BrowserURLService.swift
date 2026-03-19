import Foundation
#if canImport(AppKit)
import AppKit
import ApplicationServices
#endif

/// Unified service for extracting browser tab URLs using multiple strategies:
/// 1. AppleScript (highest accuracy, requires Automation permission)
/// 2. Accessibility API URL extraction (good accuracy, fragile across versions)
/// 3. Window title parsing (lowest accuracy, always available)
final class BrowserURLService {

    enum URLSource: String, Sendable {
        case appleScript
        case accessibilityAPI
        case windowTitleHeuristic
        case browserExtension
    }

    struct BrowserTabInfo: Sendable {
        let url: String?
        let title: String?
        let domain: String?
        let source: URLSource
        let confidence: Double
    }

    static let shared = BrowserURLService()
    private init() {}

    #if canImport(AppKit)

    /// Gets the current URL from the frontmost browser, trying methods in order of reliability.
    func currentTab(
        bundleId: String,
        windowTitle: String?,
        pid: pid_t
    ) -> BrowserTabInfo {
        if let result = tryAppleScript(bundleId: bundleId) {
            return result
        }

        if let result = tryAccessibilityURL(pid: pid) {
            return result
        }

        if let title = windowTitle {
            return parseWindowTitle(title, bundleId: bundleId)
        }

        return BrowserTabInfo(
            url: nil,
            title: windowTitle,
            domain: nil,
            source: .windowTitleHeuristic,
            confidence: 0.1
        )
    }

    // MARK: - AppleScript

    private func tryAppleScript(bundleId: String) -> BrowserTabInfo? {
        if bundleId == "org.mozilla.firefox" { return nil }

        let url: String?
        let title: String?

        if bundleId == "com.apple.Safari" {
            url = safariCurrentURL()
            title = safariCurrentTitle()
        } else if BrowserRecord.isChromiumBrowser(bundleId) {
            let appName = chromiumAppName(for: bundleId)
            url = chromiumCurrentURL(appName: appName)
            title = chromiumCurrentTitle(appName: appName)
        } else {
            return nil
        }

        guard let url, !url.isEmpty else { return nil }

        return BrowserTabInfo(
            url: url,
            title: title,
            domain: extractDomain(from: url),
            source: .appleScript,
            confidence: 1.0
        )
    }

    private func safariCurrentURL() -> String? {
        let script = NSAppleScript(source: """
            tell application "Safari"
                return URL of front document
            end tell
        """)
        var error: NSDictionary?
        let result = script?.executeAndReturnError(&error)
        if let errorDict = error,
           let errorNumber = errorDict[NSAppleScript.errorNumber] as? Int,
           errorNumber == -1743 {
            return nil
        }
        return result?.stringValue
    }

    private func safariCurrentTitle() -> String? {
        let script = NSAppleScript(source: """
            tell application "Safari"
                return name of front document
            end tell
        """)
        var error: NSDictionary?
        return script?.executeAndReturnError(&error).stringValue
    }

    private func chromiumCurrentURL(appName: String) -> String? {
        let script = NSAppleScript(source: """
            tell application "\(appName)"
                return URL of active tab of front window
            end tell
        """)
        var error: NSDictionary?
        let result = script?.executeAndReturnError(&error)
        if let errorDict = error,
           let errorNumber = errorDict[NSAppleScript.errorNumber] as? Int,
           errorNumber == -1743 {
            return nil
        }
        return result?.stringValue
    }

    private func chromiumCurrentTitle(appName: String) -> String? {
        let script = NSAppleScript(source: """
            tell application "\(appName)"
                return title of active tab of front window
            end tell
        """)
        var error: NSDictionary?
        return script?.executeAndReturnError(&error).stringValue
    }

    private func chromiumAppName(for bundleId: String) -> String {
        switch bundleId {
        case "com.google.Chrome": return "Google Chrome"
        case "com.brave.Browser": return "Brave Browser"
        case "company.thebrowser.Browser": return "Arc"
        case "com.microsoft.edgemac": return "Microsoft Edge"
        case "com.operasoftware.Opera": return "Opera"
        case "com.vivaldi.Vivaldi": return "Vivaldi"
        case "org.chromium.Chromium": return "Chromium"
        default: return "Google Chrome"
        }
    }

    // MARK: - Accessibility API

    private func tryAccessibilityURL(pid: pid_t) -> BrowserTabInfo? {
        let appElement = AXUIElementCreateApplication(pid)

        var focusedWindow: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            appElement,
            kAXFocusedWindowAttribute as CFString,
            &focusedWindow
        ) == .success else { return nil }

        if let url = findURLInWebArea(focusedWindow as! AXUIElement) {
            return BrowserTabInfo(
                url: url,
                title: nil,
                domain: extractDomain(from: url),
                source: .accessibilityAPI,
                confidence: 0.85
            )
        }

        if let url = findAddressBarValue(focusedWindow as! AXUIElement) {
            return BrowserTabInfo(
                url: url,
                title: nil,
                domain: extractDomain(from: url),
                source: .accessibilityAPI,
                confidence: 0.75
            )
        }

        return nil
    }

    private func findURLInWebArea(_ element: AXUIElement, depth: Int = 0) -> String? {
        guard depth < 12 else { return nil }

        var role: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)

        if let roleStr = role as? String, roleStr == "AXWebArea" {
            var urlValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, "AXURL" as CFString, &urlValue) == .success,
               let url = urlValue {
                return (url as? URL)?.absoluteString ?? (url as? String)
            }
        }

        var children: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
              let childArray = children as? [AXUIElement] else { return nil }

        for child in childArray {
            if let url = findURLInWebArea(child, depth: depth + 1) {
                return url
            }
        }
        return nil
    }

    private func findAddressBarValue(_ element: AXUIElement, depth: Int = 0) -> String? {
        guard depth < 8 else { return nil }

        var role: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
        let roleStr = role as? String ?? ""

        if roleStr == "AXTextField" || roleStr == "AXSafariAddressAndSearchField" {
            var value: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value) == .success,
               let urlString = value as? String,
               urlString.contains(".") && !urlString.contains(" ") {
                return urlString.hasPrefix("http") ? urlString : "https://\(urlString)"
            }
        }

        var children: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
              let childArray = children as? [AXUIElement] else { return nil }

        for child in childArray {
            if let url = findAddressBarValue(child, depth: depth + 1) {
                return url
            }
        }
        return nil
    }

    // MARK: - Window Title Fallback

    private func parseWindowTitle(_ title: String, bundleId: String) -> BrowserTabInfo {
        let browserName = BrowserRecord.browserName(for: bundleId) ?? ""
        var cleanTitle = title
        for sep in [" - \(browserName)", " — \(browserName)", " – \(browserName)"] {
            if cleanTitle.hasSuffix(sep) {
                cleanTitle = String(cleanTitle.dropLast(sep.count))
                break
            }
        }

        let domain = inferDomain(from: cleanTitle)

        return BrowserTabInfo(
            url: nil,
            title: cleanTitle.isEmpty ? nil : cleanTitle,
            domain: domain,
            source: .windowTitleHeuristic,
            confidence: domain != nil ? 0.4 : 0.2
        )
    }

    // MARK: - Helpers

    private func extractDomain(from urlString: String) -> String? {
        guard let url = URL(string: urlString), let host = url.host else {
            let pattern = try? NSRegularExpression(pattern: #"^(?:https?://)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"#)
            if let match = pattern?.firstMatch(in: urlString, range: NSRange(urlString.startIndex..., in: urlString)),
               let range = Range(match.range(at: 1), in: urlString) {
                return String(urlString[range]).lowercased()
            }
            return nil
        }
        return host.lowercased()
    }

    private func inferDomain(from title: String) -> String? {
        let knownSites: [(pattern: String, domain: String)] = [
            ("YouTube", "youtube.com"),
            ("GitHub", "github.com"),
            ("Stack Overflow", "stackoverflow.com"),
            ("Reddit", "reddit.com"),
            ("Twitter", "twitter.com"),
            ("Gmail", "mail.google.com"),
            ("Google Docs", "docs.google.com"),
            ("Google Sheets", "sheets.google.com"),
            ("Notion", "notion.so"),
            ("Slack", "slack.com"),
            ("Discord", "discord.com"),
            ("LinkedIn", "linkedin.com"),
            ("Amazon", "amazon.com"),
            ("Netflix", "netflix.com"),
            ("Wikipedia", "wikipedia.org"),
        ]
        let lowered = title.lowercased()
        for (pattern, domain) in knownSites {
            if lowered.contains(pattern.lowercased()) { return domain }
        }
        return nil
    }

    #endif
}
