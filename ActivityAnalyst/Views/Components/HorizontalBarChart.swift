import SwiftUI

/// A horizontal ranked bar chart for displaying top apps, browsers, or websites.
/// Each bar shows the item name, duration, and a proportional colored bar.
struct HorizontalBarChart: View {
    let items: [RankedItem]
    let maxItems: Int
    let showPercentage: Bool
    let onSelect: ((RankedItem) -> Void)?

    init(
        items: [RankedItem],
        maxItems: Int = 10,
        showPercentage: Bool = true,
        onSelect: ((RankedItem) -> Void)? = nil
    ) {
        self.items = items
        self.maxItems = maxItems
        self.showPercentage = showPercentage
        self.onSelect = onSelect
    }

    private var displayItems: [RankedItem] {
        Array(items.prefix(maxItems))
    }

    private var maxDuration: TimeInterval {
        displayItems.map(\.duration).max() ?? 1
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.barSpacing) {
            ForEach(displayItems) { item in
                HorizontalBarRow(
                    item: item,
                    maxDuration: maxDuration,
                    showPercentage: showPercentage
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    onSelect?(item)
                }
            }
        }
    }
}

struct HorizontalBarRow: View {
    let item: RankedItem
    let maxDuration: TimeInterval
    let showPercentage: Bool

    private var barFraction: CGFloat {
        guard maxDuration > 0 else { return 0 }
        return CGFloat(item.duration / maxDuration)
    }

    var body: some View {
        HStack(spacing: Theme.spacing8) {
            Image(systemName: item.category.sfSymbol)
                .font(.system(size: 12))
                .foregroundStyle(Theme.Colors.category(item.category))
                .frame(width: 16, alignment: .center)

            Text(item.name)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.primaryText)
                .lineLimit(1)
                .frame(width: 120, alignment: .leading)

            GeometryReader { geometry in
                RoundedRectangle(cornerRadius: Theme.barCornerRadius)
                    .fill(Theme.Colors.category(item.category))
                    .frame(width: geometry.size.width * barFraction)
                    .animation(Theme.animationMedium, value: barFraction)
            }
            .frame(height: Theme.barHeight)

            Text(DurationFormatter.format(item.duration))
                .font(Theme.Typography.monoSmall)
                .foregroundStyle(Theme.Colors.secondaryText)
                .frame(width: 60, alignment: .trailing)

            if showPercentage {
                Text("\(Int(item.percentage * 100))%")
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Colors.tertiaryText)
                    .frame(width: 32, alignment: .trailing)
            }
        }
        .frame(height: Theme.barHeight)
    }
}
