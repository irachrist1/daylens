import SwiftUI

/// Design system tokens for consistent spacing, typography, and colors.
enum DS {
    // MARK: - Spacing (8pt grid)
    static let space2: CGFloat = 2
    static let space4: CGFloat = 4
    static let space6: CGFloat = 6
    static let space8: CGFloat = 8
    static let space12: CGFloat = 12
    static let space16: CGFloat = 16
    static let space20: CGFloat = 20
    static let space24: CGFloat = 24
    static let space32: CGFloat = 32
    static let space40: CGFloat = 40
    static let space48: CGFloat = 48

    // MARK: - Corner Radius
    static let radiusSmall: CGFloat = 4
    static let radiusMedium: CGFloat = 8
    static let radiusLarge: CGFloat = 12

    // MARK: - Sidebar
    static let sidebarWidth: CGFloat = 220
    static let sidebarItemHeight: CGFloat = 32

    // MARK: - Colors
    static let accent = Color.accentColor
    static let secondaryText = Color.secondary
    static let tertiaryText = Color(.tertiaryLabelColor)
    static let separator = Color(.separatorColor)
    static let cardBackground = Color(.controlBackgroundColor)
    static let windowBackground = Color(.windowBackgroundColor)

    // MARK: - Category Colors
    static func categoryColor(for category: AppCategory) -> Color {
        switch category {
        case .productivity: return .blue
        case .communication: return .green
        case .browser: return .orange
        case .entertainment: return .pink
        case .utility: return .gray
        case .development: return .purple
        case .design: return .indigo
        case .other: return .secondary
        }
    }
}

// MARK: - View Extensions

extension View {
    func cardStyle() -> some View {
        self
            .padding(DS.space16)
            .background(DS.cardBackground, in: RoundedRectangle(cornerRadius: DS.radiusMedium))
    }

    func sectionHeader() -> some View {
        self
            .font(.headline)
            .foregroundStyle(.primary)
            .padding(.bottom, DS.space4)
    }
}
