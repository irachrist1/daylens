import Foundation
#if canImport(AppKit)
import AppKit
import ApplicationServices
#endif

/// Monitors frontmost window changes using the Accessibility API.
/// Provides richer context like window titles, which enables browser URL
/// inference as a fallback when extensions are not installed.
final class WindowMonitor {
    var onWindowEvent: ((ActivityEvent) -> Void)?

    private var currentWindowTitle: String?
    private var axObserver: AnyObject?
    private var pollTimer: Timer?

    func startMonitoring() {
        #if canImport(AppKit)
        startWindowTitlePolling()
        #endif
    }

    func stopMonitoring() {
        #if canImport(AppKit)
        pollTimer?.invalidate()
        pollTimer = nil
        axObserver = nil
        #endif
    }

    #if canImport(AppKit)
    /// Polls the frontmost window title at a low frequency.
    /// AX observer callbacks are preferred but require per-app setup;
    /// polling at 1-2s intervals is acceptable as a universal fallback.
    private func startWindowTitlePolling() {
        pollTimer = Timer.scheduledTimer(
            withTimeInterval: 1.5,
            repeats: true
        ) { [weak self] _ in
            self?.checkFrontmostWindow()
        }
    }

    private func checkFrontmostWindow() {
        guard let frontmost = NSWorkspace.shared.frontmostApplication,
              let bundleId = frontmost.bundleIdentifier else {
            return
        }

        let pid = frontmost.processIdentifier
        let appElement = AXUIElementCreateApplication(pid)

        var focusedWindow: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(
            appElement,
            kAXFocusedWindowAttribute as CFString,
            &focusedWindow
        )

        guard result == .success, let windowElement = focusedWindow else {
            return
        }

        var titleValue: CFTypeRef?
        let titleResult = AXUIElementCopyAttributeValue(
            windowElement as! AXUIElement,
            kAXTitleAttribute as CFString,
            &titleValue
        )

        guard titleResult == .success, let title = titleValue as? String else {
            return
        }

        if title != currentWindowTitle {
            let previousTitle = currentWindowTitle
            currentWindowTitle = title

            handleWindowTitleChange(
                bundleId: bundleId,
                newTitle: title,
                previousTitle: previousTitle
            )
        }
    }

    private func handleWindowTitleChange(
        bundleId: String,
        newTitle: String,
        previousTitle: String?
    ) {
        let isBrowser = BrowserRecord.isBrowser(bundleId)

        var metadata: [String: String] = [
            "bundleIdentifier": bundleId,
            "windowTitle": newTitle,
        ]

        if let prev = previousTitle {
            metadata["previousWindowTitle"] = prev
        }

        var url: String?
        var pageTitle: String?
        var websiteId: UUID?
        var confidence: Double = 0.9

        if isBrowser {
            let parsed = parseBrowserWindowTitle(newTitle, browserBundleId: bundleId)
            url = parsed.inferredUrl
            pageTitle = parsed.pageTitle
            confidence = parsed.confidence

            if let domain = parsed.inferredDomain {
                websiteId = UUID()
                metadata["inferredDomain"] = domain
            }

            metadata["source"] = "windowTitle"
        }

        let appId = UUID(uuid: UUID.namespaceDNS(bundleId))
        let browserId = isBrowser ? UUID(uuid: UUID.namespaceDNS("browser.\(bundleId)")) : nil

        let event = ActivityEvent(
            eventType: isBrowser ? .urlChanged : .tabChanged,
            appId: appId,
            browserId: browserId,
            websiteId: websiteId,
            windowTitle: newTitle,
            url: url,
            pageTitle: pageTitle,
            source: .heuristic,
            confidence: confidence,
            metadata: metadata
        )

        onWindowEvent?(event)
    }

    // MARK: - Browser Window Title Parsing

    /// Extracts page title and potential domain from browser window titles.
    /// Browser window titles typically follow the pattern "Page Title - BrowserName"
    /// or "Page Title — BrowserName". Some browsers include the URL or domain.
    private func parseBrowserWindowTitle(
        _ title: String,
        browserBundleId: String
    ) -> (pageTitle: String?, inferredUrl: String?, inferredDomain: String?, confidence: Double) {
        let browserName = BrowserRecord.browserName(for: browserBundleId) ?? ""

        var cleanTitle = title
        let separators = [" - \(browserName)", " — \(browserName)", " – \(browserName)"]
        for separator in separators {
            if cleanTitle.hasSuffix(separator) {
                cleanTitle = String(cleanTitle.dropLast(separator.count))
                break
            }
        }

        var inferredDomain: String?
        var inferredUrl: String?
        var confidence: Double = 0.4

        let urlPattern = try? NSRegularExpression(
            pattern: #"^(https?://)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"#,
            options: []
        )

        if let match = urlPattern?.firstMatch(
            in: cleanTitle,
            options: [],
            range: NSRange(cleanTitle.startIndex..., in: cleanTitle)
        ) {
            if let domainRange = Range(match.range(at: 2), in: cleanTitle) {
                inferredDomain = String(cleanTitle[domainRange]).lowercased()
                inferredUrl = cleanTitle
                confidence = 0.5
            }
        }

        if inferredDomain == nil {
            let domainHints = extractDomainHints(from: cleanTitle)
            if let hint = domainHints {
                inferredDomain = hint
                confidence = 0.3
            }
        }

        return (
            pageTitle: cleanTitle.isEmpty ? nil : cleanTitle,
            inferredUrl: inferredUrl,
            inferredDomain: inferredDomain,
            confidence: confidence
        )
    }

    private func extractDomainHints(from title: String) -> String? {
        let knownSitePatterns: [(pattern: String, domain: String)] = [
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
        for (pattern, domain) in knownSitePatterns {
            if lowered.contains(pattern.lowercased()) {
                return domain
            }
        }

        return nil
    }
    #endif
}
