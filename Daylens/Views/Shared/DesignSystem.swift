import SwiftUI

/// Design system tokens: "The Intelligent Monolith"
/// Super-black foundation with tonal layering — no 1px borders.
enum DS {
    // MARK: - Spacing (8pt grid)
    static let space2: CGFloat = 2
    static let space4: CGFloat = 4
    static let space6: CGFloat = 6
    static let space8: CGFloat = 8
    static let space10: CGFloat = 10
    static let space12: CGFloat = 12
    static let space14: CGFloat = 14
    static let space16: CGFloat = 16
    static let space18: CGFloat = 18
    static let space20: CGFloat = 20
    static let space24: CGFloat = 24
    static let space28: CGFloat = 28
    static let space32: CGFloat = 32
    static let space40: CGFloat = 40
    static let space48: CGFloat = 48

    // MARK: - Corner Radius
    static let radiusSmall: CGFloat = 4
    static let radiusMedium: CGFloat = 8
    static let radiusLarge: CGFloat = 12
    static let radiusFull: CGFloat = 999

    // MARK: - Sidebar
    static let sidebarWidth: CGFloat = 240
    static let sidebarItemHeight: CGFloat = 34

    // MARK: - Surface Hierarchy
    // Workspaces are defined by background color shifts — not borders.
    /// Global app backdrop
    static let surfaceLowest    = Color(hex: "0b0e14")
    /// Base surface
    static let surface          = Color(hex: "10131a")
    /// Sidebar / secondary panels
    static let surfaceLow       = Color(hex: "191c22")
    /// Active content area
    static let surfaceContainer = Color(hex: "1d2026")
    /// Elevated cards (one tier above content area)
    static let surfaceHigh      = Color(hex: "272a30")
    /// Interactive elements, highest elevation
    static let surfaceHighest   = Color(hex: "32353c")

    // MARK: - Text Hierarchy
    /// Primary text — never pure #fff
    static let onSurface        = Color(hex: "e1e2eb")
    /// Secondary / body text
    static let onSurfaceVariant = Color(hex: "c2c6d6")

    // MARK: - Brand: Electric Blue
    static let primary          = Color(hex: "adc6ff")
    static let primaryContainer = Color(hex: "4d8eff")
    static let onPrimaryFixed   = Color(hex: "ffffff")
    static let primaryFixedDim  = Color(hex: "adc6ff")

    // MARK: - Semantic Accents
    /// Amber — Meetings / Calendar
    static let secondary = Color(hex: "ffb95f")
    /// Teal — Communication / Messaging
    static let tertiary  = Color(hex: "4fdbc8")

    // MARK: - Gradients
    /// Jewel-like blue gradient for primary actions
    static let primaryGradient = LinearGradient(
        colors: [Color(hex: "adc6ff"), Color(hex: "4d8eff")],
        startPoint: UnitPoint(x: 0.1, y: 0.0),
        endPoint: UnitPoint(x: 0.9, y: 1.0)
    )

    // MARK: - Category Colors (tuned for dark mode)
    static func categoryColor(for category: AppCategory) -> Color {
        switch category {
        case .development:   return primary
        case .communication: return tertiary
        case .research:      return Color(hex: "c084fc")
        case .writing:       return Color(hex: "93c5fd")
        case .aiTools:       return Color(hex: "e879f9")
        case .design:        return Color(hex: "f472b6")
        case .browsing:      return Color(hex: "fb923c")
        case .meetings:      return secondary
        case .entertainment: return Color(hex: "f87171")
        case .system:        return Color(hex: "94a3b8")
        case .uncategorized: return Color(hex: "64748b")
        }
    }
}

// MARK: - Color(hex:) initializer

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:  (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:  (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:  (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - View Modifiers

extension View {
    /// Card with elevated tonal background. No border — depth via color shift.
    func cardStyle() -> some View {
        self
            .padding(DS.space16)
            .background(DS.surfaceHigh, in: RoundedRectangle(cornerRadius: DS.radiusLarge, style: .continuous))
    }

    /// Section header: small-caps, tracked, muted.
    func sectionHeader() -> some View {
        self
            .font(.system(.caption, design: .default, weight: .semibold))
            .textCase(.uppercase)
            .tracking(0.8)
            .foregroundStyle(DS.onSurfaceVariant)
            .padding(.bottom, DS.space4)
    }

    /// Header chrome: solid tonal surface instead of a divider line.
    func chromeBackground() -> some View {
        self.background(DS.surfaceLow)
    }
}
