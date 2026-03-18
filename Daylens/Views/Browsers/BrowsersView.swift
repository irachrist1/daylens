import SwiftUI

struct BrowsersView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = BrowsersViewModel()

    var body: some View {
        ScrollView {
            if viewModel.summaries.isEmpty && !viewModel.isLoading {
                EmptyStateView(
                    icon: "globe",
                    title: "No Browser Data Yet",
                    description: "Browser usage will appear here as you browse. Daylens reads your browser history locally — no extensions needed."
                )
            } else {
                VStack(alignment: .leading, spacing: DS.space16) {
                    let maxDuration = viewModel.summaries.first?.totalDuration ?? 1

                    ForEach(viewModel.summaries) { browser in
                        BrowserRow(browser: browser, maxDuration: maxDuration)
                    }
                }
                .padding(DS.space24)
            }
        }
        .onAppear { viewModel.load(for: appState.selectedDate) }
        .onChange(of: appState.selectedDate) { _, date in viewModel.load(for: date) }
    }
}

struct BrowserRow: View {
    let browser: BrowserUsageSummary
    let maxDuration: TimeInterval

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack(spacing: DS.space12) {
                AppIconView(bundleID: browser.browserBundleID, size: 36)

                VStack(alignment: .leading, spacing: DS.space2) {
                    HStack {
                        Text(browser.browserName)
                            .font(.body.weight(.medium))
                        Spacer()
                        Text(browser.formattedDuration)
                            .font(.body.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }

                    Text("\(browser.sessionCount) session\(browser.sessionCount == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }

            if !browser.topDomains.isEmpty {
                HStack(spacing: DS.space6) {
                    Text("Top sites:")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    ForEach(browser.topDomains, id: \.self) { domain in
                        Text(domain)
                            .font(.caption)
                            .padding(.horizontal, DS.space6)
                            .padding(.vertical, DS.space2)
                            .background(Color.accentColor.opacity(0.1), in: Capsule())
                    }
                }
            }

            GeometryReader { geometry in
                RoundedRectangle(cornerRadius: DS.radiusSmall)
                    .fill(Color.orange)
                    .frame(width: geometry.size.width * min(browser.totalDuration / maxDuration, 1.0), height: 4)
            }
            .frame(height: 4)
        }
        .padding(DS.space12)
        .background(Color(.controlBackgroundColor), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
    }
}
