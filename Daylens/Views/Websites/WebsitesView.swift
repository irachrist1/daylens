import SwiftUI

struct WebsitesView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = WebsitesViewModel()

    var body: some View {
        ScrollView {
            if viewModel.summaries.isEmpty && !viewModel.isLoading {
                EmptyStateView(
                    icon: "link",
                    title: "No Website Data Yet",
                    description: "Website visits will appear here as you browse. Daylens reads your browser history locally for domain-level tracking."
                )
            } else {
                VStack(alignment: .leading, spacing: DS.space12) {
                    let maxDuration = viewModel.summaries.first?.totalDuration ?? 1

                    ForEach(viewModel.summaries) { site in
                        WebsiteRow(site: site, maxDuration: maxDuration)
                    }
                }
                .padding(DS.space24)
            }
        }
        .onAppear { viewModel.load(for: appState.selectedDate) }
        .onChange(of: appState.selectedDate) { _, date in viewModel.load(for: date) }
    }
}

struct WebsiteRow: View {
    let site: WebsiteUsageSummary
    let maxDuration: TimeInterval

    var body: some View {
        HStack(spacing: DS.space12) {
            Image(systemName: "globe")
                .font(.title3)
                .foregroundStyle(.accent)
                .frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: DS.space4) {
                HStack {
                    Text(site.domain)
                        .font(.body.weight(.medium))

                    if site.confidence != .high {
                        Text("estimated")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                            .padding(.horizontal, DS.space4)
                            .padding(.vertical, 1)
                            .background(Color.orange.opacity(0.1), in: Capsule())
                    }

                    Spacer()

                    Text(site.formattedDuration)
                        .font(.body.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                if let pageTitle = site.topPageTitle {
                    Text(pageTitle)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }

                HStack(spacing: DS.space8) {
                    Text("\(site.visitCount) visit\(site.visitCount == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.tertiary)

                    Text("via \(site.browserName)")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }

                GeometryReader { geometry in
                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(Color.purple)
                        .frame(width: geometry.size.width * min(site.totalDuration / maxDuration, 1.0), height: 4)
                }
                .frame(height: 4)
            }
        }
        .padding(DS.space12)
        .background(Color(.controlBackgroundColor), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
    }
}
