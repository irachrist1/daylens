import SwiftUI

/// The main Today dashboard — default landing screen.
struct TodayView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = TodayViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space24) {
                // Overview cards
                overviewCards

                // Activity timeline
                if !viewModel.timeline.isEmpty {
                    TimelineBand(sessions: viewModel.timeline)
                }

                // AI Summary
                AISummaryCard(
                    summary: viewModel.aiSummary,
                    isLoading: viewModel.isLoadingAI,
                    onGenerate: {
                        viewModel.generateAISummary(aiService: appState.aiService, for: appState.selectedDate)
                    }
                )

                // Top Apps
                TopAppsCard(summaries: viewModel.appSummaries)

                // Top Websites
                if !viewModel.websiteSummaries.isEmpty {
                    topWebsitesSection
                }
            }
            .padding(DS.space24)
        }
        .onAppear { viewModel.load(for: appState.selectedDate) }
        .onChange(of: appState.selectedDate) { _, newDate in
            viewModel.load(for: newDate)
        }
    }

    // MARK: - Overview Cards

    private var overviewCards: some View {
        HStack(spacing: DS.space16) {
            StatCard(
                title: "Active Time",
                value: viewModel.totalActiveTime,
                icon: "clock.fill",
                color: .blue
            )

            StatCard(
                title: "Focus Score",
                value: viewModel.focusScoreText,
                subtitle: viewModel.focusLabel,
                icon: "target",
                color: .green
            )

            StatCard(
                title: "Apps Used",
                value: "\(viewModel.appSummaries.count)",
                icon: "square.grid.2x2.fill",
                color: .orange
            )

            StatCard(
                title: "Sites Visited",
                value: "\(viewModel.websiteSummaries.count)",
                icon: "globe",
                color: .purple
            )
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
                    color: .purple,
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
            HStack {
                Image(systemName: icon)
                    .foregroundStyle(color)
                Spacer()
            }

            Text(value)
                .font(.title.weight(.semibold).monospacedDigit())

            VStack(alignment: .leading, spacing: DS.space2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let subtitle {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }
}
