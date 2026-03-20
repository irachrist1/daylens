import SwiftUI

/// The main Today dashboard — default landing screen.
struct TodayView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = TodayViewModel()

    private let refreshTimer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space24) {
                greetingSection

                if viewModel.appSummaries.isEmpty && !viewModel.isLoading {
                    emptyState
                } else {
                    activeTimeHeader
                    overviewStats
                    CategoryBreakdownCard(
                        categories: viewModel.categorySummaries,
                        appSummaries: viewModel.appSummaries
                    )
                    TimelineBand(
                        sessions: viewModel.timeline,
                        categorySummaries: viewModel.categorySummaries
                    )
                    TopAppsCard(summaries: viewModel.appSummaries, date: appState.selectedDate)
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

    // MARK: - Greeting

    private var greetingSection: some View {
        Text(viewModel.greeting)
            .font(.system(.title2, design: .default, weight: .semibold))
            .foregroundStyle(DS.onSurface)
            .tracking(-0.3)
    }

    // MARK: - Active Time (display figure)

    private var activeTimeHeader: some View {
        VStack(spacing: DS.space4) {
            Text(viewModel.totalActiveTime)
                .font(.system(size: 52, weight: .bold, design: .default).monospacedDigit())
                .foregroundStyle(DS.onSurface)
                .tracking(-1.0)

            Text("active today")
                .font(.subheadline)
                .foregroundStyle(DS.onSurfaceVariant)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DS.space12)
    }

    // MARK: - Overview Stats

    private var overviewStats: some View {
        HStack(spacing: DS.space12) {
            StatCard(
                title: "Focus Score",
                value: viewModel.focusScoreText,
                subtitle: viewModel.focusLabel,
                icon: "target",
                color: DS.tertiary
            )
            StatCard(
                title: "Apps Used",
                value: "\(viewModel.appSummaries.count)",
                icon: "square.grid.2x2.fill",
                color: DS.secondary
            )
            StatCard(
                title: "Sites Visited",
                value: "\(viewModel.websiteSummaries.count)",
                icon: "globe",
                color: DS.primary
            )
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: DS.space12) {
            Image(systemName: "desktopcomputer")
                .font(.system(size: 40))
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.4))

            Text("No activity tracked yet today. Use your Mac for a few minutes and check back.")
                .font(.body)
                .foregroundStyle(DS.onSurfaceVariant)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DS.space48)
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

// MARK: - Stat Card

struct StatCard: View {
    let title: String
    let value: String
    var subtitle: String?
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            // Icon with neon-on-dark chip
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
