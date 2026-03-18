import Foundation
import AppKit

/// Fallback website attribution using the frontmost window title via Accessibility API.
/// Used when a browser extension is not installed/available.
/// Confidence level: 0.5 (lower than extension-provided data at 1.0)
final class WindowTitleHeuristics {
    static let fallbackConfidence: Double = 0.5

    /// Attempts to extract the current domain from the frontmost browser window title.
    /// Returns nil if accessibility is not available or the title doesn't contain a parseable domain.
    static func currentDomain(forBrowserBundle bundleId: String) -> (domain: String, title: String, confidence: Double)? {
        guard AXIsProcessTrusted() else { return nil }

        guard let app = NSRunningApplication.runningApplications(
            withBundleIdentifier: bundleId
        ).first else { return nil }

        let axApp = AXUIElementCreateApplication(app.processIdentifier)

        var focusedWindowValue: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(
            axApp,
            kAXFocusedWindowAttribute as CFString,
            &focusedWindowValue
        )
        guard result == .success, let window = focusedWindowValue else { return nil }

        var titleValue: CFTypeRef?
        let titleResult = AXUIElementCopyAttributeValue(
            window as! AXUIElement,
            kAXTitleAttribute as CFString,
            &titleValue
        )
        guard titleResult == .success,
              let title = titleValue as? String,
              !title.isEmpty
        else { return nil }

        if let domain = extractDomain(from: title, browserBundle: bundleId) {
            return (domain: domain, title: title, confidence: fallbackConfidence)
        }
        return nil
    }

    // MARK: - Title parsing

    /// Parses domains from common browser title patterns.
    /// Examples:
    ///   "YouTube - Google Chrome" -> "youtube.com"
    ///   "GitHub - Safari" -> "github.com"
    ///   "Stack Overflow - Question | Safari" -> "stackoverflow.com"
    ///   "youtube.com/watch?v=... — Arc" -> "youtube.com"
    private static func extractDomain(from title: String, browserBundle: String) -> String? {
        // Pattern 1: URL-like segment (contains a dot, no spaces)
        // e.g. "github.com/anthropics/anthropic-sdk-swift — Arc"
        let components = title.components(separatedBy: CharacterSet(charactersIn: " —|-"))
        for component in components {
            let trimmed = component.trimmingCharacters(in: .whitespaces)
            if looksLikeDomain(trimmed) {
                return normalizeDomain(trimmed)
            }
        }

        // Pattern 2: Known site name mapping
        // "YouTube" -> "youtube.com", "GitHub" -> "github.com", etc.
        let lower = title.lowercased()
        for (keyword, domain) in knownSiteKeywords {
            if lower.hasPrefix(keyword) || lower.contains(" \(keyword) ") {
                return domain
            }
        }

        return nil
    }

    private static func looksLikeDomain(_ string: String) -> Bool {
        // Must contain a dot, no spaces, reasonable length
        guard string.contains("."),
              !string.contains(" "),
              string.count >= 4,
              string.count <= 253
        else { return false }

        // Remove path components
        let domainPart = string.components(separatedBy: "/").first ?? string
        // Validate TLD exists (has at least one dot with content after it)
        let parts = domainPart.components(separatedBy: ".")
        return parts.count >= 2 && parts.last!.count >= 2
    }

    private static func normalizeDomain(_ raw: String) -> String {
        var domain = raw
        // Strip protocol
        for prefix in ["https://", "http://", "www."] {
            if domain.lowercased().hasPrefix(prefix) {
                domain = String(domain.dropFirst(prefix.count))
            }
        }
        // Strip path
        domain = domain.components(separatedBy: "/").first ?? domain
        // Strip query
        domain = domain.components(separatedBy: "?").first ?? domain
        return domain.lowercased()
    }

    /// Common site name → domain mappings for title-based heuristics.
    private static let knownSiteKeywords: [(String, String)] = [
        ("youtube", "youtube.com"),
        ("gmail", "gmail.com"),
        ("google", "google.com"),
        ("github", "github.com"),
        ("twitter", "twitter.com"),
        ("x.com", "x.com"),
        ("reddit", "reddit.com"),
        ("linkedin", "linkedin.com"),
        ("slack", "slack.com"),
        ("notion", "notion.so"),
        ("figma", "figma.com"),
        ("linear", "linear.app"),
        ("jira", "atlassian.net"),
        ("confluence", "atlassian.net"),
        ("stackoverflow", "stackoverflow.com"),
        ("hackernews", "news.ycombinator.com"),
        ("hacker news", "news.ycombinator.com"),
        ("spotify", "open.spotify.com"),
        ("claude", "claude.ai"),
        ("chatgpt", "chatgpt.com"),
        ("openai", "openai.com")
    ]
}
