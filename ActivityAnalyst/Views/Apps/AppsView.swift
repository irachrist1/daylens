import SwiftUI

/// Shows ranked app usage with drill-down capability.
struct AppsView: View {
    @StateObject private var viewModel = AppsViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing24) {
                header

                if viewModel.appUsage.isEmpty {
                    EmptyStateView(
                        icon: "square.grid.2x2",
                        title: "No App Data",
                        message: "App usage will appear here once tracking is active."
                    )
                } else {
                    appList
                }
            }
            .padding(Theme.spacing24)
        }
        .background(Theme.Colors.background)
        .task {
            await viewModel.loadApps()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Theme.spacing4) {
            Text("Apps")
                .font(Theme.Typography.largeTitle)
                .foregroundStyle(Theme.Colors.primaryText)

            Text("\(viewModel.appUsage.count) apps tracked today")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.secondaryText)
        }
    }

    private var appList: some View {
        VStack(alignment: .leading, spacing: Theme.spacing8) {
            ForEach(viewModel.appUsage, id: \.app.id) { item in
                AppUsageRow(
                    app: item.app,
                    duration: item.duration,
                    sessionCount: item.sessionCount,
                    isSelected: viewModel.selectedApp?.id == item.app.id
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    viewModel.selectApp(item.app)
                }
            }
        }
    }
}

struct AppUsageRow: View {
    let app: AppRecord
    let duration: TimeInterval
    let sessionCount: Int
    let isSelected: Bool

    var body: some View {
        HStack(spacing: Theme.spacing12) {
            Image(systemName: app.category.sfSymbol)
                .font(.system(size: 20))
                .foregroundStyle(Theme.Colors.category(app.category))
                .frame(width: 32, height: 32)
                .background(Theme.Colors.category(app.category).opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))

            VStack(alignment: .leading, spacing: Theme.spacing2) {
                Text(app.name)
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)

                HStack(spacing: Theme.spacing6) {
                    Text(app.category.displayName)
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Colors.tertiaryText)

                    Text("·")
                        .foregroundStyle(Theme.Colors.quaternaryText)

                    Text("\(sessionCount) session\(sessionCount == 1 ? "" : "s")")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Colors.tertiaryText)
                }
            }

            Spacer()

            Text(DurationFormatter.format(duration))
                .font(Theme.Typography.monoBody)
                .foregroundStyle(Theme.Colors.primaryText)
        }
        .padding(Theme.spacing12)
        .background(isSelected ? Theme.Colors.accentSubtle : Theme.Colors.groupedBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
    }
}
