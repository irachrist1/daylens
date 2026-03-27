import SwiftUI

/// The main Today dashboard — bento-grid layout with optional Timeline mode.
struct TodayView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = TodayViewModel()
    @State private var showAllSites = false
    @State private var insightRowHeight: CGFloat = 0
    @AppStorage("daylens.todayLayoutMode") private var layoutMode: LayoutMode = .timeline

    private enum LayoutMode: String {
        case timeline, stats, week
    }

    private let refreshTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    /// Bundle IDs and display names that are OS infrastructure, never user-initiated apps.
    /// Shared by both presentationSummaries and presentationTimeline so they can't diverge.
    private static let osNoiseBundleIDs: Set<String> = [
        "com.apple.loginwindow",
        "com.apple.dock",
        "com.apple.systemuiserver",
        "com.apple.notificationcenterui",
        "com.apple.controlcenter",
        "com.apple.screensaver.engine",
        "com.apple.backgroundtaskmanagementagent",
        "com.apple.usernotificationcenter",
        "com.apple.windowserver-target",
        "com.apple.accessibility.universalaccessd",
    ]
    private static let osNoiseNames: Set<String> = ["loginwindow", "windowserver", "universalaccessd"]

    /// Presentation-layer filter: strips OS noise and user-hidden apps.
    private var presentationSummaries: [AppUsageSummary] {
        let prefs = appState.preferencesService
        return viewModel.displayAppSummaries(for: appState.usageMetricMode).filter { app in
            let id = app.bundleID.lowercased()
            guard !Self.osNoiseBundleIDs.contains(id) else { return false }
            guard !Self.osNoiseNames.contains(app.appName.lowercased()) else { return false }
            if appState.usageMetricMode == .meaningful, app.category == .system && app.totalDuration < 30 { return false }
            if prefs?.isAppHidden(app.bundleID) == true { return false }
            return true
        }
    }

    /// Visible website summaries with hidden domains filtered out.
    private var presentationWebsites: [WebsiteUsageSummary] {
        let prefs = appState.preferencesService
        guard let prefs else { return viewModel.websiteSummaries }
        return viewModel.websiteSummaries.filter { !prefs.isDomainHidden($0.domain) }
    }

    /// Category summaries recomputed from filtered app summaries so hidden apps
    /// don't appear in the time allocation bar or intelligence insight.
    private var presentationCategorySummaries: [CategoryUsageSummary] {
        if appState.preferencesService == nil { return viewModel.categorySummaries }
        return SemanticUsageRollups.categorySummaries(from: presentationSummaries)
    }

    var body: some View {
        Group {
            if layoutMode == .timeline {
                timelineModeView
            } else if layoutMode == .week {
                weekModeView
            } else {
                statsModeView
            }
        }
        .onAppear {
            viewModel.load(for: appState.selectedDate)
            injectLiveSessionIfNeeded()
        }
        .onChange(of: appState.selectedDate) { _, newDate in
            viewModel.load(for: newDate)
        }
        .onReceive(refreshTimer) { _ in
            if Calendar.current.isDateInToday(appState.selectedDate) {
                viewModel.load(for: appState.selectedDate)
                injectLiveSessionIfNeeded()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .categoryOverrideChanged)) { _ in
            viewModel.load(for: appState.selectedDate)
        }
    }

    // MARK: - Layout Toggle

    private var layoutToggle: some View {
        Picker("", selection: $layoutMode) {
            Text("Timeline").tag(LayoutMode.timeline)
            Text("Stats").tag(LayoutMode.stats)
            Text("Week").tag(LayoutMode.week)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(width: 240)
    }

    // MARK: - Timeline Mode

    private var timelineModeView: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                layoutToggle
            }
            .padding(.horizontal, DS.space24)
            .padding(.vertical, DS.space10)

            Divider()

            if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.workBlocks.isEmpty {
                emptyState
                    .padding(DS.space24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            } else {
                let isToday = Calendar.current.isDateInToday(appState.selectedDate)
                TimelineView(
                    blocks: viewModel.workBlocks,
                    date: appState.selectedDate,
                    scrollAnchor: isToday ? .bottom : .top
                )
                .id(appState.selectedDate)
            }
        }
    }

    // MARK: - Week Mode

    private var weekModeView: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                layoutToggle
            }
            .padding(.horizontal, DS.space24)
            .padding(.vertical, DS.space10)

            Divider()

            if viewModel.weeklyScores.isEmpty {
                emptyState
                    .padding(DS.space24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            } else {
                weekRowsView
            }
        }
    }

    private var weekRowsView: some View {
        let scores = viewModel.weeklyScores.sorted { $0.date < $1.date }
        let maxTime = scores.map { appState.usageMetricMode == .meaningful ? $0.totalActiveTime : $0.appleLikeTotalActiveTime }
            .max()
            .flatMap { $0 > 0 ? $0 : nil } ?? 1
        let scoredDays = scores.filter { $0.focusScore > 0 }
        let avgFocus = scoredDays.isEmpty ? 0.0 : scoredDays.map(\.focusScore).reduce(0, +) / Double(scoredDays.count)

        return ScrollView(.vertical) {
            VStack(spacing: 0) {
                ForEach(scores) { snapshot in
                    let activeTime = appState.usageMetricMode == .meaningful ? snapshot.totalActiveTime : snapshot.appleLikeTotalActiveTime
                    let activeRatio = min(1.0, activeTime / maxTime)
                    let focusedRatio = activeRatio * snapshot.focusScore

                    HStack(spacing: DS.space12) {
                        // Day label + date number
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Self.weekDayFormatter.string(from: snapshot.date))
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(snapshot.isToday ? DS.primary : DS.onSurface)
                            Text(Self.weekDateFormatter.string(from: snapshot.date))
                                .font(.system(size: 11))
                                .foregroundStyle(DS.onSurfaceVariant)
                        }
                        .frame(width: 40, alignment: .leading)

                        // Two-tone bar: dim fill = active time, bright fill = focused time
                        ZStack(alignment: .leading) {
                            // Empty track
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(DS.surfaceHighest)
                                .frame(maxWidth: .infinity, minHeight: 6, maxHeight: 6)
                            // Active time (dim)
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(DS.primary.opacity(0.2))
                                .frame(maxWidth: .infinity, minHeight: 6, maxHeight: 6)
                                .scaleEffect(x: CGFloat(activeRatio), anchor: .leading)
                            // Focused time (teal — distinct from blue active track)
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(DS.tertiary)
                                .frame(maxWidth: .infinity, minHeight: 6, maxHeight: 6)
                                .scaleEffect(x: CGFloat(focusedRatio), anchor: .leading)
                        }

                        // Active time + focus %
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(snapshot.formattedActiveTime(for: appState.usageMetricMode))
                                .font(.system(size: 12).monospacedDigit())
                                .foregroundStyle(DS.onSurface)
                            if snapshot.focusScore > 0 {
                                Text("\(Int(snapshot.focusScore * 100))%")
                                    .font(.system(size: 11).monospacedDigit())
                                    .foregroundStyle(DS.tertiary)
                            }
                        }
                        .frame(width: 54, alignment: .trailing)
                    }
                    .frame(minHeight: 52)
                    .padding(.horizontal, DS.space24)
                }

                // Summary row
                if avgFocus > 0 {
                    Divider()
                        .padding(.horizontal, DS.space24)
                        .padding(.top, DS.space8)

                    HStack {
                        Text("Avg focus this week")
                            .font(.system(size: 12))
                            .foregroundStyle(DS.onSurfaceVariant)
                        Spacer()
                        Text("\(Int(avgFocus * 100))%")
                            .font(.system(size: 13, weight: .semibold).monospacedDigit())
                            .foregroundStyle(DS.tertiary)
                    }
                    .frame(minHeight: 44)
                    .padding(.horizontal, DS.space24)
                }
            }
            .padding(.vertical, DS.space8)
        }
    }

    private static let weekDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEE"
        return f
    }()

    private static let weekDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "d"
        return f
    }()

    // MARK: - Stats Mode

    private var statsModeView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space16) {
                HStack {
                    Spacer()
                    layoutToggle
                }

                if presentationSummaries.isEmpty && !viewModel.isLoading {
                    emptyState
                } else {
                    // Hero banner
                    HeroSummaryCard(
                        greeting: viewModel.greeting,
                        totalActiveTime: viewModel.totalActiveTime(for: appState.usageMetricMode),
                        appCount: presentationSummaries.count,
                        siteCount: presentationWebsites.count
                    )

                    // Focus ring + weekly sparkline side-by-side
                    HStack(alignment: .top, spacing: DS.space16) {
                        FocusRingCard(
                            ratio: viewModel.focusScoreRatio,
                            scoreText: viewModel.focusScoreText
                        )
                        .fixedSize(horizontal: true, vertical: false)

                        WeeklySparklineCard(days: viewModel.weeklyScores, mode: appState.usageMetricMode)
                            .frame(maxWidth: .infinity)
                    }

                    // Time allocation stacked bar
                    if !presentationCategorySummaries.isEmpty {
                        AllocationBarCard(categories: presentationCategorySummaries)
                    }

                    // Recent sessions + intelligence insight side by side
                    HStack(alignment: .top, spacing: DS.space16) {
                        RecentSessionsCard(
                            summaries: presentationSummaries,
                            onHideApp: appState.preferencesService.map { prefs in
                                { bundleID in prefs.hideApp(bundleID: bundleID) }
                            }
                        )
                        .measureCardHeight()
                            .frame(maxWidth: .infinity, minHeight: insightRowHeight, alignment: .top)
                        IntelligenceInsightCard(
                            focusScore: Int(viewModel.focusScoreRatio * 100),
                            topCategory: presentationCategorySummaries.first?.category,
                            totalSeconds: presentationSummaries.reduce(0) { $0 + $1.totalDuration }
                        )
                        .measureCardHeight()
                        .frame(width: 280, alignment: .top)
                        .frame(minHeight: insightRowHeight, alignment: .top)
                    }
                    .onPreferenceChange(CardHeightPreferenceKey.self) { insightRowHeight = $0 }

                    // Top websites
                    if !viewModel.websiteSummaries.isEmpty {
                        topWebsitesSection
                        if !viewModel.browserSummaries.isEmpty {
                            BrowserGroupsCard(
                                browsers: viewModel.browserSummaries,
                                websites: visibleSites
                            )
                        }
                    }
                }
            }
            .frame(maxWidth: 980, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(DS.space24)
            .id(appState.selectedDate)
            .transition(.opacity)
        }
        .animation(.easeOut(duration: 0.2), value: appState.selectedDate)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: DS.space16) {
            Text(viewModel.greeting)
                .font(.system(.title2, design: .default, weight: .semibold))
                .foregroundStyle(DS.onSurface)
                .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: DS.space12) {
                Image(systemName: "desktopcomputer")
                    .font(.system(size: 44))
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.35))

                Text("No activity tracked yet today.")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(DS.onSurface)

                Text("Use your Mac for a few minutes and check back.")
                    .font(.body)
                    .foregroundStyle(DS.onSurfaceVariant)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, DS.space48)
            .cardStyle()
        }
    }

    // MARK: - Helpers

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
                includeInMeaningful: true,
                includeInAppleLike: true
            )
        } else {
            if let meaningfulInfo {
                viewModel.injectLiveSession(
                    bundleID: meaningfulInfo.bundleID,
                    appName: meaningfulInfo.appName,
                    startedAt: meaningfulInfo.startedAt,
                    includeInMeaningful: true,
                    includeInAppleLike: false
                )
            }

            if let visibleInfo {
                viewModel.injectLiveSession(
                    bundleID: visibleInfo.bundleID,
                    appName: visibleInfo.appName,
                    startedAt: visibleInfo.startedAt,
                    includeInMeaningful: false,
                    includeInAppleLike: true
                )
            }
        }

        if let webInfo = appState.trackingCoordinator?.currentWebVisitInfo,
           Calendar.current.isDateInToday(appState.selectedDate) {
            viewModel.injectLiveWebsiteVisit(
                domain: webInfo.domain,
                url: webInfo.url,
                title: webInfo.title,
                startedAt: webInfo.startedAt,
                browserBundleID: webInfo.browserBundleID
            )
        }
    }

    // MARK: - Top Websites

    private var visibleSites: [WebsiteUsageSummary] {
        presentationWebsites
    }

    private var topWebsitesSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack {
                Text("Top Websites")
                    .sectionHeader()
                Spacer()
                if visibleSites.count > 3 {
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) { showAllSites.toggle() }
                    } label: {
                        Text(showAllSites ? "Show less" : "See all")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(DS.primary)
                    }
                    .buttonStyle(.plain)
                }
            }

            let displayed = showAllSites ? visibleSites : Array(visibleSites.prefix(3))
            let maxDuration = visibleSites.first?.totalDuration ?? 1

            ForEach(displayed) { site in
                let domainCat = DomainIntelligence.classify(domain: site.domain)
                let color = domainCat.category != .uncategorized
                    ? DS.categoryColor(for: domainCat.category)
                    : DS.primary
                UsageBar(
                    label: site.domain,
                    duration: site.totalDuration,
                    maxDuration: maxDuration,
                    color: color,
                    subtitle: site.topPageTitle,
                    onHide: appState.preferencesService.map { prefs in
                        { prefs.hideDomain(site.domain) }
                    }
                )
            }
        }
        .cardStyle()
    }
}

private struct CardHeightPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

private extension View {
    func measureCardHeight() -> some View {
        background(
            GeometryReader { proxy in
                Color.clear.preference(key: CardHeightPreferenceKey.self, value: proxy.size.height)
            }
        )
    }
}

// MARK: - Stat Card (used in HistoryView)

struct StatCard: View {
    let title: String
    let value: String
    var subtitle: String?
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            ZStack {
                RoundedRectangle(cornerRadius: DS.radiusSmall, style: .continuous)
                    .fill(color.opacity(0.15))
                    .frame(width: 30, height: 30)
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(color)
            }

            Text(value)
                .font(.system(.title2, design: .default, weight: .bold).monospacedDigit())
                .foregroundStyle(DS.onSurface)
                .tracking(-0.5)

            VStack(alignment: .leading, spacing: DS.space2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant)

                if let subtitle {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }
}
