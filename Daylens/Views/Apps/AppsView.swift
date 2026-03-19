import SwiftUI

struct AppsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = AppsViewModel()
    @State private var expandedBundleID: String?
    @State private var expandedWebsites: [WebsiteUsageSummary] = []
    @State private var isLoadingWebsites = false

    var body: some View {
        ScrollView {
            if viewModel.summaries.isEmpty && !viewModel.isLoading {
                EmptyStateView(
                    icon: "square.grid.2x2",
                    title: "No App Data Yet",
                    description: "Keep using your Mac. App usage will appear here within a few minutes of tracking."
                )
            } else {
                VStack(alignment: .leading, spacing: DS.space16) {
                    let maxDuration = viewModel.summaries.first?.totalDuration ?? 1

                    ForEach(viewModel.summaries) { app in
                        AppRow(
                            app: app,
                            maxDuration: maxDuration,
                            isExpanded: expandedBundleID == app.bundleID,
                            expandedWebsites: expandedBundleID == app.bundleID ? expandedWebsites : [],
                            isLoadingWebsites: expandedBundleID == app.bundleID && isLoadingWebsites,
                            onTap: { toggleExpansion(for: app.bundleID) }
                        )
                    }
                }
                .padding(DS.space24)
            }
        }
        .onAppear { viewModel.load(for: appState.selectedDate) }
        .onChange(of: appState.selectedDate) { _, date in
            expandedBundleID = nil
            viewModel.load(for: date)
        }
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
            let date = appState.selectedDate
            let results = try? await Task.detached(priority: .userInitiated) {
                try AppDatabase.shared.websiteVisitsForBrowser(
                    date: date, browserBundleID: bundleID, limit: 8
                )
            }.value

            if expandedBundleID == bundleID {
                expandedWebsites = results ?? []
                isLoadingWebsites = false
            }
        }
    }
}

struct AppRow: View {
    let app: AppUsageSummary
    let maxDuration: TimeInterval
    var isExpanded: Bool = false
    var expandedWebsites: [WebsiteUsageSummary] = []
    var isLoadingWebsites: Bool = false
    var onTap: (() -> Void)?

    private var classification: AppClassification {
        app.classification
    }

    private var isBrowserCapable: Bool {
        Constants.browserCapableBundleIDs.contains(app.bundleID)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: DS.space12) {
                AppIconView(bundleID: app.bundleID, size: 36)

                VStack(alignment: .leading, spacing: DS.space4) {
                    HStack {
                        Text(app.appName)
                            .font(.body.weight(.medium))

                        Text(classification.category.rawValue)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, DS.space4)
                            .padding(.vertical, 1)
                            .background(DS.categoryColor(for: classification.category).opacity(0.15), in: Capsule())

                        Spacer()

                        Text(app.formattedDuration)
                            .font(.body.monospacedDigit())
                            .foregroundStyle(.secondary)

                        if isBrowserCapable {
                            Image(systemName: "chevron.right")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.tertiary)
                                .rotationEffect(.degrees(isExpanded ? 90 : 0))
                                .animation(.easeOut(duration: 0.15), value: isExpanded)
                        }
                    }

                    GeometryReader { geometry in
                        RoundedRectangle(cornerRadius: DS.radiusSmall)
                            .fill(DS.categoryColor(for: classification.category))
                            .frame(width: geometry.size.width * min(app.totalDuration / maxDuration, 1.0), height: 4)
                    }
                    .frame(height: 4)

                    Text("\(app.sessionCount) session\(app.sessionCount == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                guard isBrowserCapable else { return }
                onTap?()
            }

            if isExpanded {
                BrowserWebsitesExpansion(
                    websites: expandedWebsites,
                    isLoading: isLoadingWebsites
                )
                .padding(.leading, 48) // Align with text (icon + spacing)
                .transition(.opacity.combined(with: .offset(y: -4)))
            }
        }
        .padding(DS.space12)
        .background(Color(.controlBackgroundColor), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
        .animation(.easeOut(duration: 0.2), value: isExpanded)
    }
}
