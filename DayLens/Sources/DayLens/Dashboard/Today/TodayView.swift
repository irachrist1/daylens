import SwiftUI

struct TodayView: View {
    @Environment(\.appEnvironment) private var env

    @State private var totalSeconds: Double = 0
    @State private var focusScore: Double = 0
    @State private var topApps: [AppUsageSummary] = []
    @State private var topSites: [WebsiteUsageSummary] = []
    @State private var hourlyActivity: [Double] = []
    @State private var dailySummary: DailySummary?
    @State private var isLoading = true

    private var dateKey: String {
        AppSession.makeDateKey(from: Date().timeIntervalSince1970)
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                // Header
                todayHeader

                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else if totalSeconds < 10 {
                    emptyState
                } else {
                    // AI Summary card
                    if let summary = dailySummary, let narrative = summary.aiNarrative {
                        AISummaryCard(narrative: narrative, model: summary.aiModelUsed)
                    }

                    // Key metrics row
                    metricsRow

                    // Density strip (hourly activity)
                    if !hourlyActivity.isEmpty {
                        activityStripSection
                    }

                    // Top apps
                    if !topApps.isEmpty {
                        RankedSection(title: "Top Apps", icon: "square.grid.2x2") {
                            ForEach(Array(topApps.enumerated()), id: \.element.id) { idx, app in
                                RankedBarView(
                                    rank: idx + 1,
                                    label: app.appName,
                                    sublabel: nil,
                                    seconds: app.totalSeconds,
                                    maxSeconds: topApps.first?.totalSeconds ?? 1,
                                    icon: appIcon(for: app.appBundleId),
                                    color: Color.dlAccent,
                                    onTap: { env.inspectorItem = .app(app) }
                                )
                            }
                        }
                    }

                    // Top sites
                    if !topSites.isEmpty {
                        RankedSection(title: "Top Websites", icon: "globe") {
                            ForEach(Array(topSites.enumerated()), id: \.element.id) { idx, site in
                                RankedBarView(
                                    rank: idx + 1,
                                    label: site.domain,
                                    sublabel: nil,
                                    seconds: site.totalSeconds,
                                    maxSeconds: topSites.first?.totalSeconds ?? 1,
                                    icon: nil,
                                    color: Color.dlFocusGreen,
                                    onTap: { env.inspectorItem = .website(site) }
                                )
                            }
                        }
                    }

                    // Focus breakdown
                    FocusBreakdownView(focusScore: focusScore)
                }
            }
            .padding(24)
        }
        .navigationTitle(Date().relativeLabel)
        .toolbar { refreshToolbarItem }
        .task { await loadData() }
        .refreshable { await loadData() }
    }

    // MARK: - Subviews

    private var todayHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(Date(), style: .date)
                .font(DLTypography.headingSmall)
                .foregroundColor(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(totalSeconds.durationString)
                    .font(DLTypography.displaySmall)
                Text("active")
                    .font(DLTypography.headingMedium)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var metricsRow: some View {
        HStack(spacing: 16) {
            MetricCard(
                label: "Focus Score",
                value: String(format: "%.0f%%", focusScore * 100),
                icon: "brain.head.profile",
                color: focusScore > 0.6 ? .dlFocusGreen : .dlWarningAmber
            )
            MetricCard(
                label: "Apps Used",
                value: "\(topApps.count)",
                icon: "square.grid.2x2",
                color: .dlAccent
            )
            MetricCard(
                label: "Sites Visited",
                value: "\(topSites.count)",
                icon: "globe",
                color: .dlAccent
            )
        }
    }

    private var activityStripSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Hourly Activity")
                .font(DLTypography.headingSmall)
                .foregroundColor(.secondary)
            DensityStripView(hourlySeconds: hourlyActivity, height: 20)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "clock.badge.questionmark")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text("No activity recorded yet today")
                .font(DLTypography.headingSmall)
            Text("DayLens will start building your picture as you work.")
                .font(DLTypography.bodyMedium)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding()
    }

    private var refreshToolbarItem: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button {
                Task { await loadData() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
        }
    }

    // MARK: - Data loading

    @MainActor
    private func loadData() async {
        isLoading = true
        defer { isLoading = false }

        let agg = env.aggregator
        let key = dateKey

        do {
            async let total = agg.totalActiveSeconds(for: key)
            async let focus = agg.focusScore(for: key)
            async let apps = agg.topApps(for: key, limit: 8)
            async let sites = agg.topWebsites(for: key, limit: 8)
            async let hourly = agg.hourlyActivitySeconds(for: key)
            async let summary = env.insightRepo.dailySummary(for: key)

            totalSeconds = try await total
            focusScore = try await focus
            topApps = try await apps
            topSites = try await sites
            hourlyActivity = try await hourly
            dailySummary = try await summary
        } catch {
            print("[TodayView] Data load error: \(error)")
        }
    }

    private func appIcon(for bundleId: String) -> Image? {
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first,
              let icon = app.icon
        else { return nil }
        return Image(nsImage: icon)
    }
}

// MARK: - Reusable subviews

struct MetricCard: View {
    let label: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(color)
                Text(label)
                    .font(DLTypography.caption)
                    .foregroundColor(.secondary)
            }
            Text(value)
                .font(DLTypography.metricMedium)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(NSColor.controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
    }
}

struct RankedSection<Content: View>: View {
    let title: String
    let icon: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                Text(title)
                    .font(DLTypography.headingSmall)
            }
            content()
        }
    }
}
