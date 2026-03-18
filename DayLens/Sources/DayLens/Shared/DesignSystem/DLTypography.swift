import SwiftUI

/// DayLens type scale using San Francisco (system font).
/// All sizes use Dynamic Type–compatible relative specs where appropriate.
enum DLTypography {
    // MARK: - Display (hero numbers, big metrics)
    static let displayLarge = Font.system(size: 48, weight: .semibold, design: .rounded)
    static let displayMedium = Font.system(size: 36, weight: .semibold, design: .rounded)
    static let displaySmall = Font.system(size: 28, weight: .medium, design: .rounded)

    // MARK: - Headings
    static let headingLarge = Font.system(size: 22, weight: .semibold)
    static let headingMedium = Font.system(size: 17, weight: .semibold)
    static let headingSmall = Font.system(size: 14, weight: .semibold)

    // MARK: - Body
    static let bodyLarge = Font.system(size: 15, weight: .regular)
    static let bodyMedium = Font.system(size: 13, weight: .regular)
    static let bodySmall = Font.system(size: 12, weight: .regular)

    // MARK: - Label / Caption
    static let label = Font.system(size: 11, weight: .medium)
    static let caption = Font.system(size: 11, weight: .regular)
    static let captionMono = Font.system(size: 11, weight: .regular, design: .monospaced)

    // MARK: - Sidebar
    static let sidebarItem = Font.system(size: 13, weight: .medium)
    static let sidebarSection = Font.system(size: 10, weight: .semibold)

    // MARK: - Data
    static let metricLarge = Font.system(size: 32, weight: .bold, design: .rounded)
    static let metricMedium = Font.system(size: 22, weight: .semibold, design: .rounded)
    static let metricSmall = Font.system(size: 15, weight: .semibold, design: .rounded)
}

// MARK: - View modifiers for convenience

extension View {
    func dlHeading() -> some View {
        self.font(DLTypography.headingMedium)
    }

    func dlBody() -> some View {
        self.font(DLTypography.bodyMedium)
    }

    func dlCaption() -> some View {
        self.font(DLTypography.caption)
            .foregroundColor(.secondary)
    }

    func dlMetric() -> some View {
        self.font(DLTypography.metricMedium)
    }
}
