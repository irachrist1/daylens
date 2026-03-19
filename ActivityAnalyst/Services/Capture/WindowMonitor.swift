import Foundation
#if canImport(AppKit)
import AppKit
import ApplicationServices
#endif

/// Monitors frontmost window changes using the Accessibility API and BrowserURLService.
/// For browsers, uses AppleScript-based URL extraction when available, falling back
/// to AX API and window title parsing.
final class WindowMonitor {
    var onWindowEvent: ((ActivityEvent) -> Void)?

    private var currentWindowTitle: String?
    private var currentURL: String?
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
        #endif
    }

    #if canImport(AppKit)
    private func startWindowTitlePolling() {
        pollTimer = Timer.scheduledTimer(
            withTimeInterval: 1.0,
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

        let isBrowser = BrowserRecord.isBrowser(bundleId)

        if isBrowser {
            handleBrowserWindowChange(
                bundleId: bundleId, pid: pid,
                windowTitle: title
            )
        } else if title != currentWindowTitle {
            let previousTitle = currentWindowTitle
            currentWindowTitle = title
            currentURL = nil

            handleNonBrowserWindowChange(
                bundleId: bundleId,
                newTitle: title,
                previousTitle: previousTitle
            )
        }
    }

    private func handleBrowserWindowChange(
        bundleId: String,
        pid: pid_t,
        windowTitle: String
    ) {
        let tabInfo = BrowserURLService.shared.currentTab(
            bundleId: bundleId,
            windowTitle: windowTitle,
            pid: pid
        )

        let urlChanged = tabInfo.url != currentURL
        let titleChanged = windowTitle != currentWindowTitle

        guard urlChanged || titleChanged else { return }

        currentWindowTitle = windowTitle
        currentURL = tabInfo.url

        var metadata: [String: String] = [
            "bundleIdentifier": bundleId,
            "windowTitle": windowTitle,
            "urlSource": tabInfo.source.rawValue,
        ]

        if let domain = tabInfo.domain {
            metadata["inferredDomain"] = domain
            metadata["domain"] = domain
        }

        let appId = UUID(uuid: UUID.namespaceDNS(bundleId))
        let browserId = UUID(uuid: UUID.namespaceDNS("browser.\(bundleId)"))
        let websiteId: UUID? = tabInfo.domain != nil ? UUID() : nil

        let source: CaptureSource = tabInfo.source == .appleScript ? .native : .heuristic

        let event = ActivityEvent(
            eventType: .urlChanged,
            appId: appId,
            browserId: browserId,
            websiteId: websiteId,
            windowTitle: windowTitle,
            url: tabInfo.url,
            pageTitle: tabInfo.title ?? windowTitle,
            source: source,
            confidence: tabInfo.confidence,
            metadata: metadata
        )

        onWindowEvent?(event)
    }

    private func handleNonBrowserWindowChange(
        bundleId: String,
        newTitle: String,
        previousTitle: String?
    ) {
        var metadata: [String: String] = [
            "bundleIdentifier": bundleId,
            "windowTitle": newTitle,
        ]

        if let prev = previousTitle {
            metadata["previousWindowTitle"] = prev
        }

        let appId = UUID(uuid: UUID.namespaceDNS(bundleId))

        let event = ActivityEvent(
            eventType: .windowChanged,
            appId: appId,
            windowTitle: newTitle,
            source: .native,
            confidence: 0.9,
            metadata: metadata
        )

        onWindowEvent?(event)
    }
    #endif
}
