import SwiftUI

struct BrowsersView: View {
    @Environment(\.appEnvironment) private var env
    @State private var browsers: [BrowserUsageSummary] = []
    @State private var isLoading = true

    private var dateKey: String { env.selectedDateKey }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 200)
                } else if browsers.isEmpty {
                    emptyState
                } else {
                    ForEach(Array(browsers.enumerated()), id: \.element.id) { idx, browser in
                        RankedBarView(
                            rank: idx + 1,
                            label: browser.browserName,
                            sublabel: "\(browser.sessionCount) session\(browser.sessionCount == 1 ? "" : "s")",
                            seconds: browser.totalSeconds,
                            maxSeconds: browsers.first?.totalSeconds ?? 1,
                            icon: appIcon(for: browser.browserBundleId),
                            color: Color.dlAccent,
                            onTap: { env.inspectorItem = .browser(browser) }
                        )
                        Divider()
                    }
                }
            }
            .padding(20)
        }
        .navigationTitle("Browsers")
        .task(id: dateKey) { await loadData() }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "safari").font(.system(size: 36)).foregroundColor(.secondary)
            Text("No browser usage recorded yet")
                .font(DLTypography.headingSmall).foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    @MainActor
    private func loadData() async {
        isLoading = true
        browsers = (try? env.aggregator.topBrowsers(for: dateKey, limit: 10)) ?? []
        isLoading = false
    }

    private func appIcon(for bundleId: String) -> Image? {
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first,
              let icon = app.icon else { return nil }
        return Image(nsImage: icon)
    }
}
