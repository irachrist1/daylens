import SwiftUI

struct WebsitesView: View {
    @Environment(\.appEnvironment) private var env
    @State private var sites: [WebsiteUsageSummary] = []
    @State private var isLoading = true

    private var dateKey: String { env.selectedDateKey }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 200)
                } else if sites.isEmpty {
                    emptyState
                } else {
                    ForEach(Array(sites.enumerated()), id: \.element.id) { idx, site in
                        RankedBarView(
                            rank: idx + 1,
                            label: site.domain,
                            sublabel: confidenceLabel(site.avgConfidence),
                            seconds: site.totalSeconds,
                            maxSeconds: sites.first?.totalSeconds ?? 1,
                            icon: nil,
                            color: Color.dlFocusGreen,
                            onTap: { env.inspectorItem = .website(site) }
                        )
                        Divider()
                    }
                }
            }
            .padding(20)
        }
        .navigationTitle("Websites")
        .task(id: dateKey) { await loadData() }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "globe").font(.system(size: 36)).foregroundColor(.secondary)
            Text("No website visits recorded yet")
                .font(DLTypography.headingSmall).foregroundColor(.secondary)
            Text("Install the browser extension for full website tracking.")
                .font(DLTypography.bodyMedium).foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding()
    }

    @MainActor
    private func loadData() async {
        isLoading = true
        sites = (try? env.aggregator.topWebsites(for: dateKey, limit: 30)) ?? []
        isLoading = false
    }

    private func confidenceLabel(_ confidence: Double) -> String {
        if confidence >= 0.9 { return "via extension" }
        if confidence >= 0.5 { return "estimated" }
        return "low confidence"
    }
}
