import SwiftUI

// Inspector has been removed from the UI.
// Keeping reusable helper components that may be used elsewhere.

struct InspectorSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing8) {
            Text(title)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.tertiaryText)
                .textCase(.uppercase)

            content()
        }
    }
}

struct InspectorRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.secondaryText)
            Spacer()
            Text(value)
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.primaryText)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}

struct FocusBar: View {
    let label: String
    let fraction: Double
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing2) {
            HStack {
                Text(label)
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Colors.secondaryText)
                Spacer()
                Text("\(Int(fraction * 100))%")
                    .font(Theme.Typography.monoSmall)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Theme.Colors.separator.opacity(0.3))

                    RoundedRectangle(cornerRadius: 2)
                        .fill(color)
                        .frame(width: geometry.size.width * CGFloat(fraction))
                }
            }
            .frame(height: 6)
        }
    }
}
