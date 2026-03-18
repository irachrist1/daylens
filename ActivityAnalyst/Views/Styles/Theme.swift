import SwiftUI

/// Central design system for Activity Analyst.
/// Restrained, neutral-first palette with one calm accent.
/// Inspired by macOS HIG, Arc's hierarchy, and Anthropic's restraint.
enum Theme {
    // MARK: - Spacing

    static let spacing2: CGFloat = 2
    static let spacing4: CGFloat = 4
    static let spacing6: CGFloat = 6
    static let spacing8: CGFloat = 8
    static let spacing12: CGFloat = 12
    static let spacing16: CGFloat = 16
    static let spacing20: CGFloat = 20
    static let spacing24: CGFloat = 24
    static let spacing32: CGFloat = 32
    static let spacing48: CGFloat = 48

    // MARK: - Corner Radius

    static let radiusSmall: CGFloat = 4
    static let radiusMedium: CGFloat = 8
    static let radiusLarge: CGFloat = 12
    static let radiusXL: CGFloat = 16

    // MARK: - Layout

    static let sidebarWidth: CGFloat = 220
    static let sidebarMinWidth: CGFloat = 180
    static let sidebarMaxWidth: CGFloat = 280
    static let inspectorWidth: CGFloat = 300
    static let inspectorMinWidth: CGFloat = 260
    static let inspectorMaxWidth: CGFloat = 400
    static let minimumWindowWidth: CGFloat = 900
    static let minimumWindowHeight: CGFloat = 600

    // MARK: - Animation

    static let animationFast: Animation = .easeOut(duration: 0.15)
    static let animationMedium: Animation = .easeInOut(duration: 0.25)
    static let animationSlow: Animation = .easeInOut(duration: 0.4)
    static let springResponse: Animation = .spring(response: 0.3, dampingFraction: 0.8)

    // MARK: - Bar Chart

    static let barHeight: CGFloat = 24
    static let barSpacing: CGFloat = 6
    static let barCornerRadius: CGFloat = 4
    static let maxBarWidth: CGFloat = 200

    // MARK: - Timeline

    static let timelineRowHeight: CGFloat = 44
    static let timelineHourWidth: CGFloat = 80
    static let densityStripHeight: CGFloat = 20
}

// MARK: - Colors

extension Theme {
    enum Colors {
        // Primary accent — a calm, restrained teal-blue
        static let accent = Color("AccentColor")
        static let accentSubtle = Color("AccentColor").opacity(0.15)

        // Semantic
        static let focus = Color(nsColor: .systemGreen).opacity(0.85)
        static let distraction = Color(nsColor: .systemOrange).opacity(0.85)
        static let idle = Color(nsColor: .systemGray).opacity(0.5)
        static let warning = Color(nsColor: .systemYellow)
        static let error = Color(nsColor: .systemRed)

        // Surfaces
        static let background = Color(nsColor: .windowBackgroundColor)
        static let secondaryBackground = Color(nsColor: .controlBackgroundColor)
        static let tertiaryBackground = Color(nsColor: .underPageBackgroundColor)
        static let groupedBackground = Color(nsColor: .controlBackgroundColor)

        // Text
        static let primaryText = Color(nsColor: .labelColor)
        static let secondaryText = Color(nsColor: .secondaryLabelColor)
        static let tertiaryText = Color(nsColor: .tertiaryLabelColor)
        static let quaternaryText = Color(nsColor: .quaternaryLabelColor)

        // Borders and separators
        static let separator = Color(nsColor: .separatorColor)
        static let border = Color(nsColor: .gridColor)

        // Category colors — muted, professional palette
        static func category(_ category: ActivityCategory) -> Color {
            switch category {
            case .productivity: return Color(hue: 0.58, saturation: 0.45, brightness: 0.75)
            case .communication: return Color(hue: 0.55, saturation: 0.40, brightness: 0.80)
            case .entertainment: return Color(hue: 0.08, saturation: 0.50, brightness: 0.85)
            case .social: return Color(hue: 0.85, saturation: 0.35, brightness: 0.80)
            case .reference: return Color(hue: 0.45, saturation: 0.35, brightness: 0.75)
            case .development: return Color(hue: 0.60, saturation: 0.50, brightness: 0.70)
            case .design: return Color(hue: 0.80, saturation: 0.40, brightness: 0.80)
            case .writing: return Color(hue: 0.15, saturation: 0.40, brightness: 0.80)
            case .finance: return Color(hue: 0.35, saturation: 0.45, brightness: 0.70)
            case .shopping: return Color(hue: 0.10, saturation: 0.45, brightness: 0.80)
            case .news: return Color(hue: 0.00, saturation: 0.35, brightness: 0.80)
            case .health: return Color(hue: 0.95, saturation: 0.40, brightness: 0.80)
            case .education: return Color(hue: 0.70, saturation: 0.40, brightness: 0.75)
            case .utilities: return Color(hue: 0.00, saturation: 0.00, brightness: 0.65)
            case .uncategorized: return Color(hue: 0.00, saturation: 0.00, brightness: 0.55)
            }
        }
    }
}

// MARK: - Typography

extension Theme {
    enum Typography {
        static let largeTitle = Font.system(size: 26, weight: .bold, design: .default)
        static let title = Font.system(size: 20, weight: .semibold, design: .default)
        static let title2 = Font.system(size: 17, weight: .semibold, design: .default)
        static let title3 = Font.system(size: 15, weight: .semibold, design: .default)
        static let headline = Font.system(size: 13, weight: .semibold, design: .default)
        static let body = Font.system(size: 13, weight: .regular, design: .default)
        static let callout = Font.system(size: 12, weight: .regular, design: .default)
        static let subheadline = Font.system(size: 11, weight: .regular, design: .default)
        static let footnote = Font.system(size: 10, weight: .regular, design: .default)
        static let caption = Font.system(size: 10, weight: .medium, design: .default)

        // Monospaced for durations, numbers
        static let monoBody = Font.system(size: 13, weight: .regular, design: .monospaced)
        static let monoSmall = Font.system(size: 11, weight: .regular, design: .monospaced)
        static let monoLarge = Font.system(size: 20, weight: .medium, design: .monospaced)
    }
}
