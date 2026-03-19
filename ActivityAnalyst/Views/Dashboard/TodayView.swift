import SwiftUI

/// The Today view — the default landing surface.
/// Shows a narrative-first overview of the current day's activity.
struct TodayView: View {
    @StateObject private var viewModel = DashboardViewModel()
    @ObservedObject private var services = ServiceContainer.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing24) {
                headerSection
                summaryCards
                categoryBreakdownSection
                topAppsSection
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

    // MARK: - Category Breakdown (PRD 11.7: time spent by category)

    private var categoryBreakdownSection: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            Text("Time by Category")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.primaryText)

            if let summary = viewModel.dailySummary, !summary.topApps.isEmpty {
                let categories = aggregateByCategory(summary.topApps + summary.topWebsites)
                VStack(spacing: Theme.spacing6) {
                    ForEach(categories.prefix(6), id: \.category) { item in
                        HStack(spacing: Theme.spacing8) {
                            Image(systemName: item.category.sfSymbol)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.Colors.category(item.category))
                                .frame(width: 16)

                            Text(item.category.displayName)
                                .font(Theme.Typography.body)
                                .frame(minWidth: 80, alignment: .leading)
                                .lineLimit(1)

                            GeometryReader { geometry in
                                RoundedRectangle(cornerRadius: Theme.barCornerRadius)
                                    .fill(Theme.Colors.category(item.category))
                                    .frame(width: max(4, geometry.size.width * CGFloat(item.fraction)))
                            }
                            .frame(height: 20)

                            Text(DurationFormatter.format(item.duration))
                                .font(Theme.Typography.monoSmall)
                                .foregroundStyle(Theme.Colors.secondaryText)
                                .frame(minWidth: 45, alignment: .trailing)

                            Text(DurationFormatter.formatPercentage(item.fraction))
                                .font(Theme.Typography.footnote)
                                .foregroundStyle(Theme.Colors.tertiaryText)
                                .frame(minWidth: 28, alignment: .trailing)
                        }
                    }
                }
            } else {
                Text("No category data yet")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            }
        }
    }

    private func aggregateByCategory(_ items: [RankedItem]) -> [(category: ActivityCategory, duration: TimeInterval, fraction: Double)] {
        var totals: [ActivityCategory: TimeInterval] = [:]
        for item in items {
            totals[item.category, default: 0] += item.duration
        }
        let grandTotal = totals.values.reduce(0, +)
        return totals
            .sorted { $0.value > $1.value }
            .map { (category: $0.key, duration: $0.value, fraction: grandTotal > 0 ? $0.value / grandTotal : 0) }
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

    // MARK: - Top Browsers (PRD 11.7)

    private var topBrowsersSection: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            HStack {
                Text("Top Browsers")
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)
                Spacer()
            }

            if let summary = viewModel.dailySummary, !summary.topBrowsers.isEmpty {
                HorizontalBarChart(
                    items: summary.topBrowsers,
                    maxItems: 5
                )
            } else {
                Text("No browser activity recorded yet")
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

    // MARK: - Trend Snapshots (PRD 11.7: trend snapshots across recent days)

    private var trendSnapshotSection: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            Text("Recent Trends")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.primaryText)

            HStack(spacing: Theme.spacing12) {
                ForEach(0..<5, id: \.self) { dayOffset in
                    let date = Calendar.current.date(byAdding: .day, value: -(4 - dayOffset), to: viewModel.selectedDate)!
                    let summary = viewModel.recentTrendSummaries.first { Calendar.current.isDate($0.date, inSameDayAs: date) }
                    TrendDayCell(
                        date: date,
                        isToday: Calendar.current.isDateInToday(date),
                        activeTime: summary?.totalActiveTime,
                        focusScore: summary?.focusScore,
                        sessionCount: summary?.sessionCount
                    )
                }
                Spacer()
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

                if services.hasAI {
                    Circle()
                        .fill(.green)
                        .frame(width: 8, height: 8)
                }

                Spacer()

                if viewModel.dailySummary?.aiSummary == nil && services.hasAI {
                    Button("Generate") {
                        Task {
                            viewModel.generateAISummary()
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
            } else if !services.hasAI {
                HStack(spacing: Theme.spacing8) {
                    Image(systemName: "key.fill")
                        .foregroundStyle(.orange)
                    Text("Add your Anthropic API key in Settings to enable AI summaries.")
                        .font(Theme.Typography.callout)
                        .foregroundStyle(Theme.Colors.secondaryText)
                }
                .padding(Theme.spacing16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.06))
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
                            appName: viewModel.appNames[session.appId] ?? "Unknown App",
                            category: session.category,
                            startTime: session.startTime,
                            duration: session.duration,
                            websiteDomain: session.websiteId.flatMap { viewModel.websiteDomains[$0] },
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

// MARK: - Trend Day Cell

struct TrendDayCell: View {
    let date: Date
    let isToday: Bool
    let activeTime: TimeInterval?
    let focusScore: Double?
    let sessionCount: Int?

    private var hasData: Bool { activeTime != nil }

    private var activityLevel: Double {
        guard let time = activeTime else { return 0 }
        return min(time / (8 * 3600), 1.0)
    }

    var body: some View {
        VStack(spacing: Theme.spacing4) {
            Text(dayLabel)
                .font(Theme.Typography.caption)
                .foregroundStyle(isToday ? Theme.Colors.accent : Theme.Colors.tertiaryText)

            ZStack {
                RoundedRectangle(cornerRadius: Theme.radiusSmall)
                    .fill(cellBackground)
                    .frame(width: 56, height: 56)

                VStack(spacing: 2) {
                    Text(dayNumber)
                        .font(Theme.Typography.headline)
                        .foregroundStyle(isToday ? .white : Theme.Colors.secondaryText)

                    if hasData {
                        Text(DurationFormatter.formatCompact(activeTime ?? 0))
                            .font(.system(size: 9, weight: .medium, design: .monospaced))
                            .foregroundStyle(isToday ? .white.opacity(0.8) : Theme.Colors.tertiaryText)
                    }
                }
            }

            if let score = focusScore, hasData {
                HStack(spacing: 2) {
                    Circle()
                        .fill(score > 0.5 ? Theme.Colors.focus : Theme.Colors.distraction)
                        .frame(width: 5, height: 5)
                    Text("\(Int(score * 100))%")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(Theme.Colors.tertiaryText)
                }
            }
        }
    }

    private var cellBackground: Color {
        if isToday {
            return Theme.Colors.accent
        }
        if hasData {
            return Theme.Colors.accent.opacity(0.1 + activityLevel * 0.25)
        }
        return Theme.Colors.separator.opacity(0.15)
    }

    private var dayLabel: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE"
        return formatter.string(from: date)
    }

    private var dayNumber: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter.string(from: date)
    }
}
