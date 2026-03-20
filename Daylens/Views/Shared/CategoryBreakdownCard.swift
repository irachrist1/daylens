import SwiftUI

/// Expandable category breakdown that reveals the apps within each category.
struct CategoryBreakdownCard: View {
    let categories: [CategoryUsageSummary]
    let appSummaries: [AppUsageSummary]
    @State private var expandedCategory: AppCategory?

    var body: some View {
        if categories.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: DS.space12) {
                Text("Categories")
                    .sectionHeader()

                let maxDuration = categories.first?.totalDuration ?? 1

                ForEach(categories) { categorySummary in
                    let isExpanded = expandedCategory == categorySummary.category

                    VStack(spacing: 0) {
                        CategoryUsageRow(
                            summary: categorySummary,
                            maxDuration: maxDuration,
                            isExpanded: isExpanded
                        )
                        .contentShape(Rectangle())
                        .onTapGesture {
                            expandedCategory = isExpanded ? nil : categorySummary.category
                        }

                        if isExpanded {
                            VStack(alignment: .leading, spacing: DS.space6) {
                                ForEach(apps(for: categorySummary.category)) { app in
                                    CategoryAppRow(app: app)
                                }
                            }
                            .padding(.top, DS.space6)
                            .padding(.leading, DS.space8)
                            .transition(.opacity.combined(with: .offset(y: -4)))
                        }
                    }
                    .animation(.easeOut(duration: 0.18), value: isExpanded)
                }
            }
            .cardStyle()
        }
    }

    private func apps(for category: AppCategory) -> [AppUsageSummary] {
        appSummaries
            .filter { $0.classification.category == category }
            .sorted { lhs, rhs in
                if lhs.totalDuration == rhs.totalDuration {
                    return lhs.appName.localizedCaseInsensitiveCompare(rhs.appName) == .orderedAscending
                }
                return lhs.totalDuration > rhs.totalDuration
            }
    }
}

private struct CategoryUsageRow: View {
    let summary: CategoryUsageSummary
    let maxDuration: TimeInterval
    let isExpanded: Bool

    private var fraction: Double {
        guard maxDuration > 0 else { return 0 }
        return min(summary.totalDuration / maxDuration, 1.0)
    }

    private var color: Color { DS.categoryColor(for: summary.category) }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space4) {
            HStack(spacing: DS.space8) {
                Text(summary.category.rawValue)
                    .font(.body)
                    .foregroundStyle(DS.onSurface)
                    .lineLimit(1)

                Spacer()

                Text(summary.formattedDuration)
                    .font(.body.monospacedDigit())
                    .foregroundStyle(DS.onSurfaceVariant)

                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(color.opacity(0.10))
                        .frame(height: 5)

                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(color)
                        .frame(width: geometry.size.width * fraction, height: 5)
                        .shadow(color: color.opacity(0.4), radius: 3, x: 0, y: 0)
                }
            }
            .frame(height: 5)

            Text(summary.topApps.joined(separator: ", "))
                .font(.caption)
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
                .lineLimit(1)
        }
        .padding(.vertical, DS.space4)
    }
}

private struct CategoryAppRow: View {
    let app: AppUsageSummary

    var body: some View {
        HStack(spacing: DS.space8) {
            AppIconView(bundleID: app.bundleID, size: 18)

            Text(app.appName)
                .font(.caption)
                .foregroundStyle(DS.onSurface)
                .lineLimit(1)

            Spacer()

            Text(app.formattedDuration)
                .font(.caption.monospacedDigit())
                .foregroundStyle(DS.onSurfaceVariant)
        }
    }
}
