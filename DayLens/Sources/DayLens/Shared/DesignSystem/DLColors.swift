import SwiftUI

/// DayLens design system: neutral-first palette with a single restrained accent.
/// Built on semantic names so it adapts gracefully to dark mode.
enum DLColors {
    // MARK: - Background
    /// Primary app background — near-white / near-black
    static let background = Color("DLBackground", bundle: nil)
    /// Sidebar / secondary surface
    static let surface = Color("DLSurface", bundle: nil)
    /// Elevated card / inspector surface
    static let elevated = Color("DLElevated", bundle: nil)

    // MARK: - Text
    /// Primary readable text
    static let textPrimary = Color.primary
    /// Secondary, descriptive text
    static let textSecondary = Color.secondary
    /// Tertiary / placeholder
    static let textTertiary = Color(NSColor.tertiaryLabelColor)

    // MARK: - Borders & Dividers
    static let divider = Color(NSColor.separatorColor)
    static let border = Color(NSColor.separatorColor).opacity(0.6)

    // MARK: - Accent (single restrained warm-slate accent)
    /// Accent — used sparingly for CTAs, active states, highlights
    static let accent = Color("DLAccent", bundle: nil)
    static let accentMuted = Color("DLAccent", bundle: nil).opacity(0.15)

    // MARK: - Semantic
    static let focusGreen  = Color("DLFocusGreen", bundle: nil)
    static let warningAmber = Color("DLWarningAmber", bundle: nil)
    static let neutralGray = Color(NSColor.systemGray)

    // MARK: - App category colors (for timeline segments)
    static func colorForCategory(_ category: AppCategory) -> Color {
        switch category {
        case .productivity: return Color("DLCatProductivity", bundle: nil)
        case .communication: return Color("DLCatCommunication", bundle: nil)
        case .browser: return Color("DLCatBrowser", bundle: nil)
        case .creative: return Color("DLCatCreative", bundle: nil)
        case .entertainment: return Color("DLCatEntertainment", bundle: nil)
        case .system: return Color(NSColor.systemGray).opacity(0.5)
        case .other: return Color(NSColor.systemGray).opacity(0.35)
        }
    }
}

// MARK: - Fallbacks for asset catalog colors
// These provide reasonable defaults if the asset catalog is not yet populated.
extension Color {
    static var dlBackground: Color { Color(NSColor.windowBackgroundColor) }
    static var dlSurface: Color { Color(NSColor.controlBackgroundColor) }
    static var dlElevated: Color { Color(NSColor.underPageBackgroundColor) }
    static var dlAccent: Color { Color(red: 0.35, green: 0.45, blue: 0.65) } // Muted slate blue
    static var dlFocusGreen: Color { Color(red: 0.25, green: 0.65, blue: 0.45) }
    static var dlWarningAmber: Color { Color(red: 0.85, green: 0.6, blue: 0.2) }
}

// MARK: - App categories

enum AppCategory: String, CaseIterable {
    case productivity    = "Productivity"
    case communication   = "Communication"
    case browser         = "Browser"
    case creative        = "Creative"
    case entertainment   = "Entertainment"
    case system          = "System"
    case other           = "Other"

    static func classify(bundleId: String, appName: String) -> AppCategory {
        let id = bundleId.lowercased()
        let name = appName.lowercased()

        if KnownBrowser.isBrowser(bundleId: bundleId) { return .browser }

        let productivityIds = [
            "com.apple.xcode", "com.jetbrains", "com.sublimetext", "com.microsoft.vscode",
            "com.figma", "com.notion", "com.linear", "io.linearmodo",
            "com.apple.notes", "com.apple.pages", "com.microsoft.word",
            "com.microsoft.excel", "com.apple.numbers"
        ]
        if productivityIds.contains(where: { id.hasPrefix($0) }) { return .productivity }

        let commIds = [
            "com.apple.mail", "com.tinyspeck.slackmacgap", "com.hnc.discord",
            "com.microsoft.teams", "ru.keepcoder.telegram", "com.apple.facetime",
            "com.zoom.xos"
        ]
        if commIds.contains(where: { id.hasPrefix($0) }) { return .communication }

        let creativeIds = [
            "com.adobe", "com.sketchapp", "com.bohemiancoding",
            "com.apple.garageband", "com.apple.logic", "com.apple.photos",
            "com.pixelmator", "com.affinity"
        ]
        if creativeIds.contains(where: { id.hasPrefix($0) }) { return .creative }

        let entertainIds = [
            "com.spotify", "com.apple.music", "com.apple.tv",
            "com.netflix", "com.vlc-ios", "org.videolan.vlc"
        ]
        if entertainIds.contains(where: { id.hasPrefix($0) }) { return .entertainment }

        let systemIds = [
            "com.apple.finder", "com.apple.systempreferences",
            "com.apple.terminal", "com.apple.activitymonitor"
        ]
        if systemIds.contains(where: { id.hasPrefix($0) }) { return .system }

        return .other
    }
}
