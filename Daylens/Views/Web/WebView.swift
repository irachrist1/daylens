import SwiftUI

struct WebView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = BrowsersViewModel()
    @State private var selectedBrowser: BrowserUsageSummary?

    var body: some View {
        ScrollView {
            if viewModel.summaries.isEmpty && !viewModel.isLoading {
                EmptyStateView(
                    icon: "globe",
                    title: "No Browser Data Yet",
                    description: "Browser usage will appear here as you browse. Daylens reads your browser history locally — no extensions needed."
                )
            } else {
                VStack(alignment: .leading, spacing: DS.space12) {
                    let maxDuration = viewModel.summaries.first?.totalDuration ?? 1

                    ForEach(viewModel.summaries) { browser in
                        WebBrowserRow(browser: browser, maxDuration: maxDuration)
                            .onTapGesture { selectedBrowser = browser }
                    }
                }
                .padding(DS.space24)
            }
        }
        .onAppear { viewModel.load(for: appState.selectedDate) }
        .onChange(of: appState.selectedDate) { _, date in viewModel.load(for: date) }
        .sheet(item: $selectedBrowser) { browser in
            BrowserSitesSheet(browser: browser, date: appState.selectedDate)
        }
    }
}

// MARK: - Browser Row

struct WebBrowserRow: View {
    let browser: BrowserUsageSummary
    let maxDuration: TimeInterval

    var body: some View {
        HStack(spacing: DS.space12) {
            AppIconView(bundleID: browser.browserBundleID, size: 36)

            VStack(alignment: .leading, spacing: DS.space4) {
                HStack {
                    Text(browser.browserName)
                        .font(.body.weight(.medium))
                    Spacer()
                    Text(browser.formattedDuration)
                        .font(.body.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                GeometryReader { geometry in
                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(Color.blue)
                        .frame(width: geometry.size.width * min(browser.totalDuration / maxDuration, 1.0), height: 4)
                }
                .frame(height: 4)

                Text("\(browser.sessionCount) session\(browser.sessionCount == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(DS.space12)
        .background(Color(.controlBackgroundColor), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
        .contentShape(Rectangle())
    }
}

// MARK: - Browser Sites Sheet

struct BrowserSitesSheet: View {
    let browser: BrowserUsageSummary
    let date: Date
    @State private var sites: [WebsiteUsageSummary] = []
    @State private var isLoading = true
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                AppIconView(bundleID: browser.browserBundleID, size: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(browser.browserName)
                        .font(.headline)
                    Text(browser.formattedDuration + " today")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.escape)
            }
            .padding(DS.space20)
            .background(.bar)

            Divider()

            if isLoading {
                Spacer()
                ProgressView()
                Spacer()
            } else if sites.isEmpty {
                Spacer()
                VStack(spacing: DS.space8) {
                    Image(systemName: "link.slash")
                        .font(.system(size: 32))
                        .foregroundStyle(.tertiary)
                    Text("No sites recorded")
                        .font(.body)
                        .foregroundStyle(.secondary)
                    Text("Visit some websites and come back in a moment.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
                .padding(DS.space32)
                Spacer()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: DS.space8) {
                        let maxDuration = sites.first?.totalDuration ?? 1

                        ForEach(Array(sites.enumerated()), id: \.element.id) { index, site in
                            SiteRow(index: index + 1, site: site, maxDuration: maxDuration)
                        }
                    }
                    .padding(DS.space20)
                }
            }
        }
        .frame(width: 460, height: 500)
        .task {
            sites = (try? AppDatabase.shared.websiteVisitsForBrowser(
                date: date,
                browserBundleID: browser.browserBundleID
            )) ?? []
            isLoading = false
        }
    }
}

// MARK: - Site Row

struct SiteRow: View {
    let index: Int
    let site: WebsiteUsageSummary
    let maxDuration: TimeInterval

    var body: some View {
        HStack(spacing: DS.space12) {
            Text("\(index)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.tertiary)
                .frame(width: 20, alignment: .trailing)

            VStack(alignment: .leading, spacing: DS.space4) {
                HStack {
                    Text(site.domain)
                        .font(.body)
                        .lineLimit(1)
                    Spacer()
                    Text(site.formattedDuration)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                GeometryReader { geometry in
                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(Color.blue.opacity(0.4))
                        .frame(width: geometry.size.width * min(site.totalDuration / maxDuration, 1.0), height: 3)
                }
                .frame(height: 3)

                if let title = site.topPageTitle {
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, DS.space6)
    }
}
