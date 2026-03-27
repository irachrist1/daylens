import SwiftUI

struct AppsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = AppsViewModel()

    private var visibleSummaries: [AppUsageSummary] {
        let prefs = appState.preferencesService
        let summaries = viewModel.displaySummaries(for: appState.usageMetricMode)
        guard let prefs else { return summaries }
        return summaries.filter { !prefs.isAppHidden($0.bundleID) }
    }

    private let refreshTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 0) {
            appList
                .frame(width: 360)
                .background(DS.surfaceLow)

            detailPane
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(DS.surfaceContainer)
        }
        .onAppear {
            viewModel.load(for: appState.selectedDate, metricMode: appState.usageMetricMode)
            injectLiveSessionIfNeeded()
        }
        .onChange(of: appState.selectedDate) { _, date in
            viewModel.load(for: date, metricMode: appState.usageMetricMode)
        }
        .onChange(of: appState.usageMetricMode) { _, _ in
            viewModel.load(for: appState.selectedDate, metricMode: appState.usageMetricMode)
        }
        .onReceive(refreshTimer) { _ in
            if Calendar.current.isDateInToday(appState.selectedDate) {
                injectLiveSessionIfNeeded()
            }
        }
    }

    private func injectLiveSessionIfNeeded() {
        guard Calendar.current.isDateInToday(appState.selectedDate) else { return }

        let meaningfulInfo = appState.trackingCoordinator?.currentSessionInfo
        let visibleInfo = appState.trackingCoordinator?.currentVisibleSessionInfo

        if let meaningfulInfo, let visibleInfo,
           meaningfulInfo.bundleID == visibleInfo.bundleID,
           abs(meaningfulInfo.startedAt.timeIntervalSince(visibleInfo.startedAt)) < 1 {
            viewModel.injectLiveSession(
                bundleID: meaningfulInfo.bundleID,
                appName: meaningfulInfo.appName,
                startedAt: meaningfulInfo.startedAt,
                for: appState.selectedDate,
                includeInMeaningful: true,
                includeInAppleLike: true
            )
        } else {
            if let meaningfulInfo {
                viewModel.injectLiveSession(
                    bundleID: meaningfulInfo.bundleID,
                    appName: meaningfulInfo.appName,
                    startedAt: meaningfulInfo.startedAt,
                    for: appState.selectedDate,
                    includeInMeaningful: true,
                    includeInAppleLike: false
                )
            }

            if let visibleInfo {
                viewModel.injectLiveSession(
                    bundleID: visibleInfo.bundleID,
                    appName: visibleInfo.appName,
                    startedAt: visibleInfo.startedAt,
                    for: appState.selectedDate,
                    includeInMeaningful: false,
                    includeInAppleLike: true
                )
            }
        }

        if let webInfo = appState.trackingCoordinator?.currentWebVisitInfo {
            viewModel.injectLiveWebsiteVisit(
                domain: webInfo.domain,
                url: webInfo.url,
                title: webInfo.title,
                startedAt: webInfo.startedAt,
                browserBundleID: webInfo.browserBundleID,
                for: appState.selectedDate
            )
        }
    }

    private var appList: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Apps")
                .font(.system(size: 10, weight: .semibold))
                .textCase(.uppercase)
                .tracking(1.0)
                .foregroundStyle(DS.onSurfaceVariant)
                .padding(.horizontal, DS.space16)
                .padding(.vertical, DS.space16)

            if visibleSummaries.isEmpty && !viewModel.isLoading {
                EmptyStateView(
                    icon: "square.grid.2x2",
                    title: "No App Data Yet",
                    description: "Keep using your Mac. App usage will appear here within a few minutes of tracking."
                )
                .padding(DS.space16)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: DS.space8) {
                        let maxDuration = visibleSummaries.first?.totalDuration ?? 1

                        ForEach(visibleSummaries) { app in
                            AppRow(
                                app: app,
                                maxDuration: maxDuration,
                                isSelected: viewModel.selectedBundleID == app.bundleID,
                                onTap: { viewModel.selectApp(app, for: appState.selectedDate, metricMode: appState.usageMetricMode) },
                                setCategory: { cat in
                                    if let cat {
                                        viewModel.setOverride(
                                            bundleID: app.bundleID,
                                            category: cat,
                                            for: appState.selectedDate,
                                            metricMode: appState.usageMetricMode
                                        )
                                    } else {
                                        viewModel.removeOverride(
                                            bundleID: app.bundleID,
                                            for: appState.selectedDate,
                                            metricMode: appState.usageMetricMode
                                        )
                                    }
                                },
                                onHide: appState.preferencesService.map { prefs in
                                    { prefs.hideApp(bundleID: app.bundleID) }
                                }
                            )
                        }
                    }
                    .padding(DS.space16)
                }
            }
        }
    }

    @ViewBuilder
    private var detailPane: some View {
        if let selectedApp = viewModel.selectedApp(for: appState.usageMetricMode) {
            AppDetailView(
                app: selectedApp,
                date: appState.selectedDate,
                sessions: viewModel.detailSessions,
                websites: viewModel.detailWebsites,
                isLoading: viewModel.isLoadingDetail,
                setCategory: { cat in
                    if let cat {
                        viewModel.setOverride(
                            bundleID: selectedApp.bundleID,
                            category: cat,
                            for: appState.selectedDate,
                            metricMode: appState.usageMetricMode
                        )
                    } else {
                        viewModel.removeOverride(
                            bundleID: selectedApp.bundleID,
                            for: appState.selectedDate,
                            metricMode: appState.usageMetricMode
                        )
                    }
                }
            )
        } else {
            VStack(spacing: DS.space12) {
                Image(systemName: "square.grid.2x2")
                    .font(.system(size: 32))
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.35))

                Text("Select an app to inspect its sessions")
                    .font(.body)
                    .foregroundStyle(DS.onSurfaceVariant)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct AppRow: View {
    let app: AppUsageSummary
    let maxDuration: TimeInterval
    let isSelected: Bool
    let onTap: () -> Void
    var setCategory: ((AppCategory?) -> Void)? = nil
    var onHide: (() -> Void)? = nil

    @State private var isHovered = false

    private var classification: AppClassification { app.classification }
    private var color: Color { DS.categoryColor(for: classification.category) }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: DS.space12) {
                AppRealIcon(bundleID: app.bundleID, name: app.appName, category: classification.category, size: 36)

                VStack(alignment: .leading, spacing: DS.space4) {
                    HStack {
                        Text(app.appName)
                            .font(.body.weight(.medium))
                            .foregroundStyle(DS.onSurface)

                        CategoryBadge(category: classification.category)

                        Spacer()

                        Text(app.formattedDuration)
                            .font(.body.monospacedDigit())
                            .foregroundStyle(DS.onSurfaceVariant)
                    }

                    GeometryReader { geometry in
                        RoundedRectangle(cornerRadius: DS.radiusSmall)
                            .fill(color)
                            .frame(width: geometry.size.width * min(app.totalDuration / maxDuration, 1.0), height: 3)
                            .shadow(color: color.opacity(0.5), radius: 3, x: 0, y: 0)
                    }
                    .frame(height: 3)

                    Text("\(app.sessionCount) session\(app.sessionCount == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
                }

                if isHovered, let onHide {
                    Button {
                        onHide()
                    } label: {
                        Image(systemName: "eye.slash")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(DS.onSurfaceVariant)
                    }
                    .buttonStyle(.plain)
                    .help("Hide this app")
                    .transition(.opacity)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(DS.onSurfaceVariant.opacity(0.45))
                }
            }
            .padding(DS.space12)
            .background(
                RoundedRectangle(cornerRadius: DS.radiusLarge, style: .continuous)
                    .fill(rowBackground)
            )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .animation(.easeOut(duration: 0.12), value: isHovered)
        .animation(.easeOut(duration: 0.15), value: isSelected)
        .contextMenu {
            Menu("Set Category") {
                ForEach(AppCategory.allCases, id: \.self) { cat in
                    Button {
                        setCategory?(cat)
                    } label: {
                        Label(cat.rawValue, systemImage: cat.icon)
                    }
                }
            }
            Divider()
            Button("Reset to Auto-detect") { setCategory?(nil) }
        }
    }

    private var rowBackground: Color {
        if isSelected {
            return DS.primary.opacity(0.12)
        }
        return isHovered ? DS.surfaceHighest : DS.surfaceHigh
    }
}
