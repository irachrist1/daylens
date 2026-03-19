import SwiftUI

/// Card showing top apps by usage time.
/// Browser-capable apps are tappable and expand to show top websites.
struct TopAppsCard: View {
    let summaries: [AppUsageSummary]
    let date: Date
    @State private var expandedBundleID: String?
    @State private var expandedWebsites: [WebsiteUsageSummary] = []
    @State private var isLoadingWebsites = false

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Top Apps")
                .sectionHeader()

            if summaries.isEmpty {
                Text("No app data yet. Keep using your Mac and check back soon.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, DS.space8)
            } else {
                let maxDuration = summaries.first?.totalDuration ?? 1

                ForEach(summaries) { app in
                    let isBrowserCapable = Constants.browserCapableBundleIDs.contains(app.bundleID)
                    let isExpanded = expandedBundleID == app.bundleID

                    VStack(spacing: 0) {
                        HStack(spacing: DS.space12) {
                            AppIconView(bundleID: app.bundleID, size: 24)

                            UsageBar(
                                label: app.appName,
                                duration: app.totalDuration,
                                maxDuration: maxDuration,
                                color: DS.categoryColor(for: app.classification.category)
                            )

                            if isBrowserCapable {
                                Image(systemName: "chevron.right")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
                                    .animation(.easeOut(duration: 0.15), value: isExpanded)
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            guard isBrowserCapable else { return }
                            toggleExpansion(for: app.bundleID)
                        }

                        if isExpanded {
                            BrowserWebsitesExpansion(
                                websites: expandedWebsites,
                                isLoading: isLoadingWebsites
                            )
                            .transition(.opacity.combined(with: .offset(y: -4)))
                        }
                    }
                    .animation(.easeOut(duration: 0.2), value: isExpanded)
                }
            }
        }
        .cardStyle()
    }

    private func toggleExpansion(for bundleID: String) {
        if expandedBundleID == bundleID {
            expandedBundleID = nil
            expandedWebsites = []
            isLoadingWebsites = false
        } else {
            expandedBundleID = bundleID
            loadWebsites(for: bundleID)
        }
    }

    private func loadWebsites(for bundleID: String) {
        isLoadingWebsites = true
        expandedWebsites = []

        Task { @MainActor in
            let results = try? await Task.detached(priority: .userInitiated) {
                try AppDatabase.shared.websiteVisitsForBrowser(
                    date: date, browserBundleID: bundleID, limit: 5
                )
            }.value

            // Only update if this browser is still expanded
            if expandedBundleID == bundleID {
                expandedWebsites = results ?? []
                isLoadingWebsites = false
            }
        }
    }
}

/// Inline expansion showing top websites for a browser app.
struct BrowserWebsitesExpansion: View {
    let websites: [WebsiteUsageSummary]
    let isLoading: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space6) {
            if isLoading {
                ProgressView()
                    .controlSize(.small)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, DS.space8)
            } else if websites.isEmpty {
                Text("No website data for this browser.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, DS.space8)
            } else {
                ForEach(websites.prefix(5)) { site in
                    HStack(spacing: DS.space8) {
                        Image(systemName: "globe")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .frame(width: 14)

                        Text(site.domain)
                            .font(.caption)
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                        Spacer()

                        Text(site.formattedDuration)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.leading, 36) // Align with the app name (icon width + spacing)
        .padding(.top, DS.space6)
        .padding(.bottom, DS.space4)
    }
}
