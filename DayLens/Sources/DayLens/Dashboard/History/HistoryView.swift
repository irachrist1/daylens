import SwiftUI

struct HistoryView: View {
    @Environment(\.appEnvironment) private var env
    @State private var trends: [DailyAggregator.DayTrend] = []

    var body: some View {
        List(trends) { trend in
            Button {
                env.selectedDateKey = trend.dateKey
                env.selectedSection = .today
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(trend.dateKey)
                            .font(DLTypography.bodyMedium)
                        Text(trend.totalActiveSeconds.durationString + " active")
                            .font(DLTypography.caption)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                    HStack(spacing: 4) {
                        Circle()
                            .fill(trend.focusScore > 0.6 ? Color.dlFocusGreen : Color.dlWarningAmber)
                            .frame(width: 6, height: 6)
                        Text(String(format: "%.0f%% focus", trend.focusScore * 100))
                            .font(DLTypography.caption)
                            .foregroundColor(.secondary)
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 4)
            }
            .buttonStyle(.plain)
        }
        .navigationTitle("History")
        .task {
            trends = (try? env.aggregator.recentTrends(days: 30)) ?? []
        }
    }
}
