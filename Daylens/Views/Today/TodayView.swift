import SwiftUI

/// The main Today dashboard — bento-grid layout.
struct TodayView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = TodayViewModel()
    @State private var showAllSites = false

    private let refreshTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    /// Presentation-layer filter: strips OS-session processes that are not user-initiated apps.
    /// Keeps the Today surface trustworthy without touching the tracking engine.
    /// A deeper Codex pass will handle this at the source.
    private var presentationSummaries: [AppUsageSummary] {
        // Bundle IDs that are OS infrastructure, never user-initiated apps
        let osNoiseBundleIDs: Set<String> = [
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
        return viewModel.appSummaries.filter { app in
            let id = app.bundleID.lowercased()
            let name = app.appName.lowercased()
            guard !osNoiseBundleIDs.contains(id) else { return false }
            // Catch noise that slips through with a name-based check
            let noiseNames = ["loginwindow", "windowserver", "universalaccessd"]
            guard !noiseNames.contains(name) else { return false }
            // Hide very-brief system-category entries (background churn, < 30 s)
            if app.category == .system && app.totalDuration < 30 { return false }
            return true
        }
    }

    private var presentationTimeline: [AppSession] {
        let osNoiseBundleIDs: Set<String> = [
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
        return viewModel.timeline.filter { session in
            let id = session.bundleID.lowercased()
            let name = session.appName.lowercased()
            guard !osNoiseBundleIDs.contains(id) else { return false }
            let noiseNames = ["loginwindow", "windowserver", "universalaccessd"]
            guard !noiseNames.contains(name) else { return false }
            return true
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space16) {
                if presentationSummaries.isEmpty && !viewModel.isLoading {
                    emptyState
                } else {
                    // Hero banner
                    HeroSummaryCard(
                        greeting: viewModel.greeting,
                        totalActiveTime: viewModel.totalActiveTime,
                        appCount: presentationSummaries.count,
                        siteCount: viewModel.websiteSummaries.count
                    )

                    // Focus ring + weekly sparkline side-by-side
                    HStack(alignment: .top, spacing: DS.space16) {
                        FocusRingCard(
                            ratio: viewModel.focusScoreRatio,
                            scoreText: viewModel.focusScoreText
                        )
                        .fixedSize(horizontal: true, vertical: false)

                        WeeklySparklineCard(days: viewModel.weeklyScores)
                            .frame(maxWidth: .infinity)
                    }

                    // Time allocation stacked bar
                    if !viewModel.categorySummaries.isEmpty {
                        AllocationBarCard(categories: viewModel.categorySummaries)
                    }

                    // Activity timeline
                    TimelineBand(
                        sessions: presentationTimeline,
                        categorySummaries: viewModel.categorySummaries
                    )

                    // Recent sessions + intelligence insight side by side
                    HStack(alignment: .top, spacing: DS.space16) {
                        RecentSessionsCard(summaries: presentationSummaries)
                            .frame(maxWidth: .infinity)
                        IntelligenceInsightCard(
                            focusScore: Int(viewModel.focusScoreRatio * 100),
                            topCategory: viewModel.categorySummaries.first?.category,
                            totalSeconds: presentationSummaries.reduce(0) { $0 + $1.totalDuration }
                        )
                        .frame(width: 280)
                    }

                    // Top websites
                    if !viewModel.websiteSummaries.isEmpty {
                        topWebsitesSection
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
        if let info = appState.trackingCoordinator?.currentSessionInfo,
           Calendar.current.isDateInToday(appState.selectedDate) {
            viewModel.injectLiveSession(
                bundleID: info.bundleID,
                appName: info.appName,
                startedAt: info.startedAt
            )
        }
    }

    // MARK: - Top Websites

    /// Sites with at least 1 minute of active time, sorted by duration desc.
    private var longSites: [WebsiteUsageSummary] {
        viewModel.websiteSummaries.filter { $0.totalDuration >= 60 }
    }

    private var topWebsitesSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack {
                Text("Top Websites")
                    .sectionHeader()
                Spacer()
                if longSites.count > 5 {
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) { showAllSites.toggle() }
                    } label: {
                        Text(showAllSites ? "Show less" : "Show all \(longSites.count)")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(DS.primary)
                    }
                    .buttonStyle(.plain)
                }
            }

            if longSites.isEmpty {
                Text("No sites with 1+ minutes of activity yet.")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
            } else {
                let displayed = showAllSites ? longSites : Array(longSites.prefix(5))
                let maxDuration = longSites.first?.totalDuration ?? 1

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
                        subtitle: site.topPageTitle
                    )
                }
            }
        }
        .cardStyle()
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
