import SwiftUI

struct BrowserGroupsCard: View {
    let browsers: [BrowserUsageSummary]
    let websites: [WebsiteUsageSummary]
    var maxSitesPerBrowser: Int = 3

    private struct ScopedWebsite: Identifiable {
        let browserBundleID: String
        let browserName: String
        let domain: String
        let totalDuration: TimeInterval
        let subtitle: String?

        var id: String { "\(browserBundleID)|\(domain)" }
    }

    var body: some View {
        if browsers.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: DS.space16) {
                Text("Browser Groups")
                    .sectionHeader()

                ForEach(browsers) { browser in
                    let scopedSites = sites(for: browser)
                    if scopedSites.isEmpty { EmptyView() } else {
                        VStack(alignment: .leading, spacing: DS.space10) {
                            HStack {
                                Text(browser.browserName)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(DS.onSurface)
                                Spacer()
                                Text(browser.formattedDuration)
                                    .font(.system(size: 13, weight: .semibold).monospacedDigit())
                                    .foregroundStyle(DS.onSurfaceVariant)
                            }

                            let maxDuration = scopedSites.first?.totalDuration ?? 1
                            ForEach(scopedSites.prefix(maxSitesPerBrowser)) { site in
                                UsageBar(
                                    label: site.domain,
                                    duration: site.totalDuration,
                                    maxDuration: maxDuration,
                                    color: DS.primary,
                                    subtitle: site.subtitle
                                )
                            }
                        }
                    }
                }
            }
            .cardStyle()
        }
    }

    private func sites(for browser: BrowserUsageSummary) -> [ScopedWebsite] {
        websites.compactMap { site in
            guard let breakdown = site.browserBreakdowns.first(where: { $0.browserBundleID == browser.browserBundleID }) else {
                return nil
            }
            return ScopedWebsite(
                browserBundleID: browser.browserBundleID,
                browserName: browser.browserName,
                domain: site.domain,
                totalDuration: breakdown.totalDuration,
                subtitle: breakdown.subtitle ?? site.representativePageTitle
            )
        }
        .sorted { lhs, rhs in
            if lhs.totalDuration == rhs.totalDuration {
                return lhs.domain.localizedCaseInsensitiveCompare(rhs.domain) == .orderedAscending
            }
            return lhs.totalDuration > rhs.totalDuration
        }
    }
}
