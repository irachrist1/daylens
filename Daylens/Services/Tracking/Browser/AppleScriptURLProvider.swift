import Foundation
import AppKit

/// Extracts the active tab URL from browsers using AppleScript/JXA.
/// This is Layer 2 of the browser URL tracking strategy — used when
/// Accessibility API extraction fails or returns unreliable results.
enum AppleScriptURLProvider {

    struct BrowserTabInfo {
        let url: String
        let title: String?
    }

    /// Get the active tab URL and title from the given browser.
    /// Returns nil if the browser doesn't support AppleScript or the script fails.
    static func activeTab(for bundleID: String) -> BrowserTabInfo? {
        guard let script = script(for: bundleID) else { return nil }
        return executeScript(script)
    }

    // MARK: - Browser-Specific Scripts

    private static func script(for bundleID: String) -> String? {
        switch bundleID {
        case "com.google.Chrome", "com.brave.Browser", "com.microsoft.edgemac",
             "com.vivaldi.Vivaldi", "com.operasoftware.Opera", "org.chromium.Chromium":
            return chromiumScript(appName: appName(for: bundleID))

        case "company.thebrowser.Browser": // Arc
            return arcScript()

        case "com.apple.Safari":
            return safariScript()

        default:
            return nil
        }
    }

    private static func chromiumScript(appName: String) -> String {
        """
        tell application "\(appName)"
            if (count of windows) > 0 then
                set theURL to URL of active tab of front window
                set theTitle to title of active tab of front window
                return theURL & "|||" & theTitle
            end if
        end tell
        """
    }

    private static func arcScript() -> String {
        """
        tell application "Arc"
            if (count of windows) > 0 then
                set theURL to URL of active tab of front window
                set theTitle to title of active tab of front window
                return theURL & "|||" & theTitle
            end if
        end tell
        """
    }

    private static func safariScript() -> String {
        """
        tell application "Safari"
            if (count of windows) > 0 then
                set theURL to URL of front document
                set theTitle to name of front document
                return theURL & "|||" & theTitle
            end if
        end tell
        """
    }

    // MARK: - Execution

    private static func executeScript(_ source: String) -> BrowserTabInfo? {
        let script = NSAppleScript(source: source)
        var error: NSDictionary?
        let result = script?.executeAndReturnError(&error)

        guard let output = result?.stringValue, error == nil else {
            return nil
        }

        let parts = output.components(separatedBy: "|||")
        let url = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)

        guard !url.isEmpty, url.contains(".") || url.hasPrefix("http") else {
            return nil
        }

        let title = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : nil

        return BrowserTabInfo(
            url: url,
            title: title?.isEmpty == true ? nil : title
        )
    }

    // MARK: - Helpers

    private static func appName(for bundleID: String) -> String {
        switch bundleID {
        case "com.google.Chrome": return "Google Chrome"
        case "com.brave.Browser": return "Brave Browser"
        case "com.microsoft.edgemac": return "Microsoft Edge"
        case "com.vivaldi.Vivaldi": return "Vivaldi"
        case "com.operasoftware.Opera": return "Opera"
        case "org.chromium.Chromium": return "Chromium"
        default: return "Google Chrome"
        }
    }
}
