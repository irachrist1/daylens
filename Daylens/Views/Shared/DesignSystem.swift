import SwiftUI

/// Chromatic Sanctuary — deep navy, editorial, high-contrast.
/// Depth through tonal layering; no 1px borders.
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
    static let radiusXL: CGFloat = 16
    static let radiusFull: CGFloat = 999

    // MARK: - Sidebar
    static let sidebarWidth: CGFloat = 220
    static let sidebarItemHeight: CGFloat = 36

    // MARK: - Surface Hierarchy (deep navy — blue-tinted dark)
    static let surfaceLowest    = Color(hex: "010f20")   // darkest backdrop
    static let surface          = Color(hex: "051425")   // app background
    static let surfaceLow       = Color(hex: "051425")   // sidebar, panels
    static let surfaceContainer = Color(hex: "0d1c2e")   // sidebar bg / secondary
    static let surfaceHigh      = Color(hex: "122032")   // content area bg
    static let surfaceCard      = Color(hex: "1d2b3d")   // card surface
    static let surfaceHighest   = Color(hex: "283648")   // interactive / hover
    static let surfaceBright    = Color(hex: "2c3a4d")   // tooltips / elevated

    // MARK: - Text
    static let onSurface        = Color(hex: "c8dcf4")   // primary — cool near-white
    static let onSurfaceVariant = Color(hex: "5e7a92")   // secondary — muted, clearly subordinate

    // MARK: - Brand: Electric Blue
    static let primary          = Color(hex: "b4c5ff")   // light periwinkle
    static let primaryContainer = Color(hex: "2563eb")   // vivid blue (buttons)
    static let onPrimaryFixed   = Color(hex: "040e1c")   // dark text on gradient/primary bg
    static let primaryFixedDim  = Color(hex: "b4c5ff")

    // MARK: - Semantic Accents
    static let secondary = Color(hex: "ffb95f")   // amber — Meetings
    static let tertiary  = Color(hex: "4fdbc8")   // teal — Communication

    // MARK: - Error
    static let error            = Color(hex: "ffb4ab")
    static let errorContainer   = Color(hex: "93000a")

    // MARK: - Structural
    static let outlineVariant = Color(hex: "434655")
    static let ghostBorder = Color.white.opacity(0.06)

    // MARK: - Gradients
    /// Blue jewel gradient — primary buttons, hero cards
    static let primaryGradient = LinearGradient(
        colors: [Color(hex: "2563eb"), Color(hex: "93c5fd")],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
    /// Wordmark gradient
    static let titleGradient = LinearGradient(
        colors: [Color(hex: "2563eb"), Color(hex: "93c5fd")],
        startPoint: .leading, endPoint: .trailing
    )
    /// Subtle hero card fill
    static let heroGradient = LinearGradient(
        colors: [Color(hex: "0f2d5e"), Color(hex: "1a4480")],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )

    // MARK: - Category Colors (tuned for navy dark)
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
        self.init(.sRGB, red: Double(r)/255, green: Double(g)/255, blue: Double(b)/255, opacity: Double(a)/255)
    }
}

// MARK: - View Modifiers

extension View {
    /// Elevated card surface: surfaceCard bg, large radius, ambient primary glow.
    func cardStyle() -> some View {
        self
            .padding(DS.space16)
            .background(DS.surfaceCard, in: RoundedRectangle(cornerRadius: DS.radiusXL, style: .continuous))
            .shadow(color: DS.primary.opacity(0.05), radius: 18, x: 0, y: 3)
    }

    /// Label-style section header: uppercase, tracked, muted.
    func sectionHeader() -> some View {
        self
            .font(.system(.caption, design: .default, weight: .semibold))
            .textCase(.uppercase)
            .tracking(1.0)
            .foregroundStyle(DS.onSurfaceVariant)
            .padding(.bottom, DS.space4)
    }

    /// Tonal chrome background (header bar).
    func chromeBackground() -> some View {
        self.background(DS.surfaceContainer)
    }
}
