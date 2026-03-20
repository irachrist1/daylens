import SwiftUI

/// The main Today dashboard — bento-grid layout.
struct TodayView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = TodayViewModel()

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
                            label: viewModel.focusLabel,
                            scoreText: viewModel.focusScoreText
                        )
                        .frame(maxWidth: .infinity)

                        WeeklySparklineCard(days: viewModel.weeklyScores)
                            .frame(maxWidth: .infinity)
                    }

                    // Time allocation stacked bar
                    if !viewModel.categorySummaries.isEmpty {
                        AllocationBarCard(categories: viewModel.categorySummaries)
                    }

                    // Activity timeline
                    TimelineBand(
                        sessions: viewModel.timeline,
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
        .onAppear { viewModel.load(for: appState.selectedDate) }
        .onChange(of: appState.selectedDate) { _, newDate in
            viewModel.load(for: newDate)
        }
        .onReceive(refreshTimer) { _ in
            if Calendar.current.isDateInToday(appState.selectedDate) {
                viewModel.load(for: appState.selectedDate)
            }
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

    // MARK: - Top Websites

    private var topWebsitesSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Top Websites")
                .sectionHeader()

            let maxDuration = viewModel.websiteSummaries.first?.totalDuration ?? 1

            ForEach(viewModel.websiteSummaries.prefix(5)) { site in
                UsageBar(
                    label: site.domain,
                    duration: site.totalDuration,
                    maxDuration: maxDuration,
                    color: DS.primary,
                    subtitle: site.topPageTitle
                )
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
