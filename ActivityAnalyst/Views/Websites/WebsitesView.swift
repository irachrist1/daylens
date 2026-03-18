import SwiftUI

/// Shows website/domain usage ranked by time spent.
struct WebsitesView: View {
    @StateObject private var viewModel = WebsitesViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing24) {
                header

                if viewModel.websiteUsage.isEmpty {
                    EmptyStateView(
                        icon: "link",
                        title: "No Website Data",
                        message: "Website visits will appear here once tracking captures browser activity."
                    )
                } else {
                    websiteList
                }
            }
            .padding(Theme.spacing24)
        }
        .background(Theme.Colors.background)
        .task {
            viewModel.loadWebsites()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Theme.spacing4) {
            Text("Websites")
                .font(Theme.Typography.largeTitle)
                .foregroundStyle(Theme.Colors.primaryText)

            Text("\(viewModel.websiteUsage.count) domains tracked today")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.secondaryText)
        }
    }

    private var websiteList: some View {
        VStack(alignment: .leading, spacing: Theme.spacing8) {
            ForEach(viewModel.websiteUsage, id: \.website.id) { item in
                WebsiteUsageRow(
                    website: item.website,
                    duration: item.duration,
                    sessionCount: item.sessionCount,
                    isSelected: viewModel.selectedWebsite?.id == item.website.id
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    viewModel.selectWebsite(item.website)
                }
            }
        }
    }
}

struct WebsiteUsageRow: View {
    let website: WebsiteRecord
    let duration: TimeInterval
    let sessionCount: Int
    let isSelected: Bool

    var body: some View {
        HStack(spacing: Theme.spacing12) {
            Image(systemName: website.category.sfSymbol)
                .font(.system(size: 16))
                .foregroundStyle(Theme.Colors.category(website.category))
                .frame(width: 32, height: 32)
                .background(Theme.Colors.category(website.category).opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))

            VStack(alignment: .leading, spacing: Theme.spacing2) {
                Text(website.domain)
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)

                HStack(spacing: Theme.spacing6) {
                    Text(website.category.displayName)
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Colors.tertiaryText)
                    Text("·")
                        .foregroundStyle(Theme.Colors.quaternaryText)
                    Text("\(sessionCount) visit\(sessionCount == 1 ? "" : "s")")
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
