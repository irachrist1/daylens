import SwiftUI

struct AppsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = AppsViewModel()

    var body: some View {
        ScrollView {
            if viewModel.summaries.isEmpty && !viewModel.isLoading {
                EmptyStateView(
                    icon: "square.grid.2x2",
                    title: "No App Data Yet",
                    description: "Keep using your Mac. App usage will appear here within a few minutes of tracking."
                )
            } else {
                VStack(alignment: .leading, spacing: DS.space16) {
                    let maxDuration = viewModel.summaries.first?.totalDuration ?? 1

                    ForEach(viewModel.summaries) { app in
                        AppRow(app: app, maxDuration: maxDuration)
                    }
                }
                .padding(DS.space24)
            }
        }
        .onAppear { viewModel.load(for: appState.selectedDate) }
        .onChange(of: appState.selectedDate) { _, date in viewModel.load(for: date) }
    }
}

struct AppRow: View {
    let app: AppUsageSummary
    let maxDuration: TimeInterval

    var body: some View {
        HStack(spacing: DS.space12) {
            AppIconView(bundleID: app.bundleID, size: 36)

            VStack(alignment: .leading, spacing: DS.space4) {
                HStack {
                    Text(app.appName)
                        .font(.body.weight(.medium))

                    Text(app.category.rawValue)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, DS.space4)
                        .padding(.vertical, 1)
                        .background(DS.categoryColor(for: app.category).opacity(0.15), in: Capsule())

                    Spacer()

                    Text(app.formattedDuration)
                        .font(.body.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                GeometryReader { geometry in
                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(DS.categoryColor(for: app.category))
                        .frame(width: geometry.size.width * min(app.totalDuration / maxDuration, 1.0), height: 4)
                }
                .frame(height: 4)

                Text("\(app.sessionCount) session\(app.sessionCount == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(DS.space12)
        .background(Color(.controlBackgroundColor), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
    }
}
