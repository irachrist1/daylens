import SwiftUI

/// Shows browser usage breakdown.
struct BrowsersView: View {
    @StateObject private var viewModel = BrowsersViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing24) {
                header

                if viewModel.browserUsage.isEmpty {
                    EmptyStateView(
                        icon: "globe",
                        title: "No Browser Data",
                        message: "Browser usage will appear here once tracking is active."
                    )
                } else {
                    browserList
                    extensionStatus
                }
            }
            .padding(Theme.spacing24)
        }
        .background(Theme.Colors.background)
        .task {
            viewModel.loadBrowsers()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Theme.spacing4) {
            Text("Browsers")
                .font(Theme.Typography.largeTitle)
                .foregroundStyle(Theme.Colors.primaryText)

            Text("\(viewModel.browserUsage.count) browsers detected")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.secondaryText)
        }
    }

    private var browserList: some View {
        VStack(alignment: .leading, spacing: Theme.spacing8) {
            ForEach(viewModel.browserUsage, id: \.browser.id) { item in
                BrowserUsageRow(
                    browser: item.browser,
                    duration: item.duration,
                    isSelected: viewModel.selectedBrowser?.id == item.browser.id
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    viewModel.selectBrowser(item.browser)
                }
            }
        }
    }

    private var extensionStatus: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            Text("Extension Status")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.primaryText)

            ForEach(viewModel.browserUsage, id: \.browser.id) { item in
                HStack {
                    Text(item.browser.name)
                        .font(Theme.Typography.body)

                    Spacer()

                    if item.browser.extensionInstalled {
                        Label("Connected", systemImage: "checkmark.circle.fill")
                            .font(Theme.Typography.footnote)
                            .foregroundStyle(.green)
                    } else {
                        Label("Not installed", systemImage: "exclamationmark.triangle.fill")
                            .font(Theme.Typography.footnote)
                            .foregroundStyle(.orange)
                    }
                }
            }
        }
        .padding(Theme.spacing16)
        .background(Theme.Colors.groupedBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
    }
}

struct BrowserUsageRow: View {
    let browser: BrowserRecord
    let duration: TimeInterval
    let isSelected: Bool

    var body: some View {
        HStack(spacing: Theme.spacing12) {
            Image(systemName: "globe")
                .font(.system(size: 20))
                .foregroundStyle(Theme.Colors.accent)
                .frame(width: 32, height: 32)
                .background(Theme.Colors.accentSubtle)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))

            VStack(alignment: .leading, spacing: Theme.spacing2) {
                Text(browser.name)
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)

                HStack(spacing: Theme.spacing4) {
                    if browser.extensionInstalled {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 8))
                            .foregroundStyle(.green)
                        Text("Extension active")
                            .font(Theme.Typography.footnote)
                            .foregroundStyle(Theme.Colors.tertiaryText)
                    } else {
                        Text("Basic tracking")
                            .font(Theme.Typography.footnote)
                            .foregroundStyle(Theme.Colors.tertiaryText)
                    }
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
