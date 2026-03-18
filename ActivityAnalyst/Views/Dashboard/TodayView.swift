import SwiftUI

/// The Today view — the default landing surface.
/// Shows a narrative-first overview of the current day's activity.
struct TodayView: View {
    @StateObject private var viewModel = DashboardViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing24) {
                headerSection
                summaryCards
                densitySection
                topAppsSection
                topWebsitesSection
                aiSummarySection
                timelinePreview
            }
            .padding(Theme.spacing24)
        }
        .background(Theme.Colors.background)
        .task {
            viewModel.loadToday()
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: Theme.spacing4) {
            Text(DateFormatters.relativeDay(viewModel.selectedDate))
                .font(Theme.Typography.largeTitle)
                .foregroundStyle(Theme.Colors.primaryText)

            Text(DateFormatters.mediumDate.string(from: viewModel.selectedDate))
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.secondaryText)
        }
    }

    // MARK: - Summary Cards

    private var summaryCards: some View {
        HStack(spacing: Theme.spacing16) {
            SummaryCard(
                title: "Active Time",
                value: DurationFormatter.format(viewModel.dailySummary?.totalActiveTime ?? 0),
                icon: "clock.fill",
                color: Theme.Colors.accent
            )

            SummaryCard(
                title: "Focus Score",
                value: DurationFormatter.formatPercentage(viewModel.dailySummary?.focusScore ?? 0),
                icon: "target",
                color: Theme.Colors.focus
            )

            SummaryCard(
                title: "Sessions",
                value: "\(viewModel.dailySummary?.sessionCount ?? 0)",
                icon: "rectangle.stack.fill",
                color: Theme.Colors.secondaryText
            )

            SummaryCard(
                title: "Switches",
                value: "\(viewModel.dailySummary?.switchCount ?? 0)",
                icon: "arrow.left.arrow.right",
                color: (viewModel.dailySummary?.fragmentationScore ?? 0) > 0.5
                    ? Theme.Colors.distraction
                    : Theme.Colors.secondaryText
            )
        }
    }

    // MARK: - Density Strip

    private var densitySection: some View {
        VStack(alignment: .leading, spacing: Theme.spacing8) {
            Text("Activity Density")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.primaryText)

            LabeledDensityStrip(hourlyActivity: viewModel.hourlyActivity.map {
                DensityStrip.HourlyBucket(
                    id: $0.id,
                    activeMinutes: $0.activeMinutes,
                    dominantCategory: $0.dominantCategory
                )
            })
        }
    }

    // MARK: - Top Apps

    private var topAppsSection: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            HStack {
                Text("Top Apps")
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)
                Spacer()
                Text("\(viewModel.dailySummary?.topApps.count ?? 0) apps tracked")
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            }

            if let summary = viewModel.dailySummary, !summary.topApps.isEmpty {
                HorizontalBarChart(
                    items: summary.topApps,
                    maxItems: 5
                )
            } else {
                Text("No app activity recorded yet")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            }
        }
    }

    // MARK: - Top Websites

    private var topWebsitesSection: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            HStack {
                Text("Top Websites")
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)
                Spacer()
            }

            if let summary = viewModel.dailySummary, !summary.topWebsites.isEmpty {
                HorizontalBarChart(
                    items: summary.topWebsites,
                    maxItems: 5
                )
            } else {
                Text("No website activity recorded yet")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            }
        }
    }

    // MARK: - AI Summary

    private var aiSummarySection: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            HStack {
                Image(systemName: "brain.head.profile")
                    .foregroundStyle(Theme.Colors.accent)
                Text("Daily Analysis")
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)
                Spacer()

                if viewModel.dailySummary?.aiSummary == nil {
                    Button("Generate") {
                        Task {
                            await viewModel.generateAISummary()
                        }
                    }
                    .buttonStyle(.borderless)
                    .font(Theme.Typography.callout)
                }
            }

            if let summary = viewModel.dailySummary?.aiSummary {
                Text(summary)
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.primaryText)
                    .padding(Theme.spacing16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.Colors.accentSubtle)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
            } else {
                Text("AI analysis will appear here once generated.")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.tertiaryText)
                    .padding(Theme.spacing16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.Colors.groupedBackground)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
            }
        }
    }

    // MARK: - Timeline Preview

    private var timelinePreview: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            HStack {
                Text("Recent Sessions")
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)
                Spacer()
            }

            if viewModel.todaySessions.isEmpty {
                Text("No sessions recorded yet")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            } else {
                VStack(spacing: 0) {
                    ForEach(viewModel.todaySessions.suffix(10)) { session in
                        SessionRow(
                            appName: "App",
                            category: session.category,
                            startTime: session.startTime,
                            duration: session.duration,
                            websiteDomain: nil,
                            confidence: session.confidence,
                            isSignificant: session.isSignificant
                        )
                        Divider()
                    }
                }
            }
        }
    }
}

// MARK: - Summary Card

struct SummaryCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing8) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundStyle(color)
                Spacer()
            }

            Text(value)
                .font(Theme.Typography.monoLarge)
                .foregroundStyle(Theme.Colors.primaryText)

            Text(title)
                .font(Theme.Typography.footnote)
                .foregroundStyle(Theme.Colors.secondaryText)
        }
        .padding(Theme.spacing16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Colors.groupedBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
    }
}
