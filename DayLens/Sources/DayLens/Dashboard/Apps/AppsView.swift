import SwiftUI

struct AppsView: View {
    @Environment(\.appEnvironment) private var env
    @State private var apps: [AppUsageSummary] = []
    @State private var isLoading = true

    private var dateKey: String { env.selectedDateKey }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 200)
                } else if apps.isEmpty {
                    emptyState
                } else {
                    ForEach(Array(apps.enumerated()), id: \.element.id) { idx, app in
                        RankedBarView(
                            rank: idx + 1,
                            label: app.appName,
                            sublabel: "\(app.sessionCount) session\(app.sessionCount == 1 ? "" : "s")",
                            seconds: app.totalSeconds,
                            maxSeconds: apps.first?.totalSeconds ?? 1,
                            icon: appIcon(for: app.appBundleId),
                            color: DLColors.colorForCategory(
                                AppCategory.classify(bundleId: app.appBundleId, appName: app.appName)
                            ),
                            onTap: { env.inspectorItem = .app(app) }
                        )
                        Divider()
                    }
                }
            }
            .padding(20)
        }
        .navigationTitle("Apps")
        .task(id: dateKey) { await loadData() }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 36)).foregroundColor(.secondary)
            Text("No app usage recorded yet")
                .font(DLTypography.headingSmall).foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    @MainActor
    private func loadData() async {
        isLoading = true
        apps = (try? env.aggregator.topApps(for: dateKey, limit: 30)) ?? []
        isLoading = false
    }

    private func appIcon(for bundleId: String) -> Image? {
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first,
              let icon = app.icon else { return nil }
        return Image(nsImage: icon)
    }
}
