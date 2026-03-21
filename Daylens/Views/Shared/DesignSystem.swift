import SwiftUI
import AppKit

/// Chromatic Sanctuary — deep navy dark / crisp blue-white light.
/// Every surface token is fully adaptive: same tonal hierarchy, flipped luminance.
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

    // MARK: - Surface Hierarchy
    //  Same tonal depth, flipped: dark = navy stack, light = blue-white stack
    static let surfaceLowest    = Color(light: "eef2fb", dark: "010f20")
    static let surface          = Color(light: "f3f6fd", dark: "051425")
    static let surfaceLow       = Color(light: "f3f6fd", dark: "051425")
    static let surfaceContainer = Color(light: "e8eef8", dark: "0d1c2e")
    static let surfaceHigh      = Color(light: "dde5f5", dark: "122032")
    static let surfaceCard      = Color(light: "ffffff", dark: "1d2b3d")
    static let surfaceHighest   = Color(light: "cdd8ef", dark: "283648")
    static let surfaceBright    = Color(light: "ffffff", dark: "2c3a4d")

    // MARK: - Text
    static let onSurface        = Color(light: "0d1f38", dark: "c8dcf4")
    static let onSurfaceVariant = Color(light: "4a6180", dark: "5e7a92")

    // MARK: - Brand: Electric Blue
    //  Dark  -> light periwinkle (readable on navy)
    //  Light -> vivid blue (readable on white)
    static let primary          = Color(light: "2563eb", dark: "b4c5ff")
    static let primaryContainer = Color(light: "2563eb", dark: "2563eb")
    static let onPrimaryFixed   = Color(light: "ffffff", dark: "040e1c")
    static let primaryFixedDim  = Color(light: "2563eb", dark: "b4c5ff")

    // MARK: - Semantic Accents
    static let secondary = Color(light: "d97706", dark: "ffb95f")   // amber
    static let tertiary  = Color(light: "0d9488", dark: "4fdbc8")   // teal

    // MARK: - Error
    static let error          = Color(light: "b91c1c", dark: "ffb4ab")
    static let errorContainer = Color(light: "fee2e2", dark: "93000a")

    // MARK: - Structural
    static let outlineVariant = Color(light: "c5d0e8", dark: "434655")
    static let ghostBorder    = Color(light: "00000014", dark: "ffffff10")

    // MARK: - Gradients
    static let primaryGradient = LinearGradient(
        colors: [Color(hex: "2563eb"), Color(hex: "93c5fd")],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
    static let titleGradient = LinearGradient(
        colors: [Color(hex: "2563eb"), Color(hex: "60a5fa")],
        startPoint: .leading, endPoint: .trailing
    )
    // Hero card: deep jewel in dark, soft blue wash in light
    static let heroGradient = LinearGradient(
        colors: [Color(light: "dce8fb", dark: "0f2d5e"),
                 Color(light: "c7d9f8", dark: "1a4480")],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )

    // MARK: - Category Colors
    //  Dark  -> pastel variants (readable on navy)
    //  Light -> saturated variants (readable on white)
    static func categoryColor(for category: AppCategory) -> Color {
        switch category {
        case .development:   return primary
        case .communication: return tertiary
        case .research:      return Color(light: "7c3aed", dark: "c084fc")
        case .writing:       return Color(light: "3b82f6", dark: "93c5fd")
        case .aiTools:       return Color(light: "a21caf", dark: "e879f9")
        case .design:        return Color(light: "be185d", dark: "f472b6")
        case .browsing:      return Color(light: "ea580c", dark: "fb923c")
        case .meetings:      return secondary
        case .entertainment: return Color(light: "dc2626", dark: "f87171")
        case .email:         return Color(light: "0891b2", dark: "67e8f9")
        case .productivity:  return Color(light: "059669", dark: "6ee7b7")
        case .social:        return Color(light: "7c3aed", dark: "a78bfa")
        case .system:        return Color(light: "475569", dark: "94a3b8")
        case .uncategorized: return Color(light: "64748b", dark: "64748b")
        }
    }
}

// MARK: - Adaptive Color initializer

extension Color {
    /// Appearance-adaptive color: resolves to lightHex in light mode, darkHex in dark.
    init(light lightHex: String, dark darkHex: String) {
        self.init(NSColor(name: nil) { $0.isDark ? NSColor(hex: darkHex) : NSColor(hex: lightHex) })
    }

    /// Fixed hex color (non-adaptive).
    init(hex: String) {
        let (r, g, b, a) = Self.hexComponents(hex)
        self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
    }

    fileprivate static func hexComponents(_ raw: String) -> (Double, Double, Double, Double) {
        let h = raw.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var n: UInt64 = 0
        Scanner(string: h).scanHexInt64(&n)
        switch h.count {
        case 3:
            return (Double((n >> 8) * 17) / 255, Double((n >> 4 & 0xF) * 17) / 255,
                    Double((n & 0xF) * 17) / 255, 1)
        case 6:
            return (Double(n >> 16) / 255, Double(n >> 8 & 0xFF) / 255, Double(n & 0xFF) / 255, 1)
        case 8:
            return (Double(n >> 16 & 0xFF) / 255, Double(n >> 8 & 0xFF) / 255,
                    Double(n & 0xFF) / 255, Double(n >> 24) / 255)
        default:
            return (0, 0, 0, 1)
        }
    }
}

private extension NSColor {
    convenience init(hex: String) {
        let (r, g, b, a) = Color.hexComponents(hex)
        self.init(srgbRed: r, green: g, blue: b, alpha: a)
    }
}

private extension NSAppearance {
    var isDark: Bool {
        bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }
}

// MARK: - View Modifiers

extension View {
    /// Elevated card: adaptive surface, large radius, soft ambient shadow.
    func cardStyle() -> some View {
        self
            .padding(DS.space16)
            .background(DS.surfaceCard, in: RoundedRectangle(cornerRadius: DS.radiusXL, style: .continuous))
            .shadow(color: Color.black.opacity(0.07), radius: 12, x: 0, y: 2)
    }

    /// Section header: uppercase, tracked, muted.
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
