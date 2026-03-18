import SwiftUI

struct InsightsView: View {
    @Environment(\.appEnvironment) private var env
    @State private var summaries: [DailySummary] = []
    @State private var trends: [DailyAggregator.DayTrend] = []

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                // Weekly trend strip
                if !trends.isEmpty {
                    weeklyTrendSection
                }

                // Recent daily summaries
                if summaries.isEmpty {
                    noSummariesBanner
                } else {
                    Text("Recent Summaries")
                        .font(DLTypography.headingSmall)

                    ForEach(summaries) { summary in
                        DailySummaryCard(summary: summary)
                    }
                }

                // Chat entry point
                chatEntrySection
            }
            .padding(24)
        }
        .navigationTitle("Insights")
        .task { await loadData() }
    }

    // MARK: - Subviews

    private var weeklyTrendSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Last 7 Days")
                .font(DLTypography.headingSmall)

            HStack(spacing: 6) {
                ForEach(trends) { trend in
                    VStack(spacing: 4) {
                        // Focus bar
                        RoundedRectangle(cornerRadius: 3)
                            .fill(trend.focusScore > 0.6 ? Color.dlFocusGreen : Color.dlWarningAmber)
                            .frame(width: .infinity, height: max(4, CGFloat(trend.focusScore) * 40))
                            .animation(.easeInOut, value: trend.focusScore)

                        Text(shortDay(trend.dateKey))
                            .font(DLTypography.caption)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 60, alignment: .bottom)
        }
    }

    private var noSummariesBanner: some View {
        VStack(spacing: 8) {
            Image(systemName: "sparkles")
                .font(.system(size: 32))
                .foregroundColor(.secondary)
            Text("No AI summaries yet")
                .font(DLTypography.headingSmall)
            Text("Summaries are generated automatically after a full day of tracking, or you can generate one now from Settings.")
                .font(DLTypography.bodyMedium)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
    }

    private var chatEntrySection: some View {
        NavigationLink(destination: ChatView()) {
            HStack(spacing: 12) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: 18))
                    .foregroundColor(Color.dlAccent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Ask about your activity")
                        .font(DLTypography.headingSmall)
                    Text("\"How much time did I spend on YouTube today?\"")
                        .font(DLTypography.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundColor(.secondary)
            }
            .padding(16)
            .background(Color(NSColor.controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Data

    @MainActor
    private func loadData() async {
        summaries = (try? env.insightRepo.recentDailySummaries(limit: 5)) ?? []
        trends = (try? env.aggregator.recentTrends(days: 7)) ?? []
    }

    private func shortDay(_ dateKey: String) -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        guard let date = fmt.date(from: dateKey) else { return "" }
        fmt.dateFormat = "EEE"
        return fmt.string(from: date)
    }
}

struct DailySummaryCard: View {
    let summary: DailySummary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(summary.dateKey)
                    .font(DLTypography.headingSmall)
                Spacer()
                Text(summary.totalActiveSeconds.durationString)
                    .font(DLTypography.metricSmall)
                    .foregroundColor(.secondary)
            }

            if let narrative = summary.aiNarrative {
                Text(narrative)
                    .font(DLTypography.bodyMedium)
                    .lineLimit(3)
            }

            if let focus = summary.focusScore {
                HStack(spacing: 4) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                    Text(String(format: "%.0f%% focus", focus * 100))
                        .font(DLTypography.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(14)
        .background(Color(NSColor.controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
    }
}
