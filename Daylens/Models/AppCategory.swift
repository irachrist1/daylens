import Foundation
import GRDB

/// Categories for apps to support focus/distraction analysis.
enum AppCategory: String, Codable, CaseIterable, DatabaseValueConvertible {
    case productivity = "Productivity"
    case communication = "Communication"
    case browser = "Browser"
    case entertainment = "Entertainment"
    case utility = "Utility"
    case development = "Development"
    case design = "Design"
    case other = "Other"

    /// Categorize an app by its bundle ID using heuristics.
    static func categorize(bundleID: String) -> AppCategory {
        if Constants.knownBrowserBundleIDs.contains(bundleID) {
            return .browser
        }
        if Constants.communicationBundleIDs.contains(bundleID) {
            return .communication
        }
        if Constants.productivityBundleIDs.contains(bundleID) {
            return .productivity
        }

        // Heuristic: development tools
        let devPatterns = [
            "xcode", "intellij", "vscode", "sublime", "terminal", "iterm", "warp",
            "cursor", "todesktop", "nova", "bbedit", "coderunner", "simulator",
            "cmux", "tmux", "ssh", "sourcetree", "tower", "fork", "github",
            "postman", "insomnia", "paw", "tableplus", "sequel", "datagrip",
            "proxyman", "charles", "wireshark", "instruments"
        ]
        if devPatterns.contains(where: { bundleID.lowercased().contains($0) }) {
            return .development
        }

        // Heuristic: design tools
        let designPatterns = ["figma", "sketch", "pixelmator", "affinity", "adobe", "canva", "framer", "principle", "zeplin", "invision"]
        if designPatterns.contains(where: { bundleID.lowercased().contains($0) }) {
            return .design
        }

        // Heuristic: entertainment
        let entertainmentPatterns = ["spotify", "music", "netflix", "youtube", "tv.app", "vlc", "mpv", "infuse", "plex", "steam", "epic", "gamepass"]
        if entertainmentPatterns.contains(where: { bundleID.lowercased().contains($0) }) {
            return .entertainment
        }

        // Heuristic: utilities
        let utilityPatterns = ["finder", "system", "utility", "calculator", "calendar", "reminders", "notes", "preview", "quicktime", "keychain", "activity.monitor", "activityanalyst", "analyst"]
        if utilityPatterns.contains(where: { bundleID.lowercased().contains($0) }) {
            return .utility
        }

        return .other
    }

    var isFocused: Bool {
        switch self {
        case .productivity, .development, .design: return true
        default: return false
        }
    }
}
