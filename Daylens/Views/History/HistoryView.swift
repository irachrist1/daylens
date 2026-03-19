import SwiftUI
import Charts

struct HistoryView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = HistoryViewModel()
    private let refreshTimer = Timer.publish(every: 15, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space24) {
                activityChart
                if !viewModel.dailySummaries.isEmpty {
                    daysList
                } else if !viewModel.isLoading {
                    emptyState
                }
            }
            .padding(DS.space24)
        }
        .onAppear { viewModel.load() }
        .onReceive(refreshTimer) { _ in viewModel.load() }
    }

    // MARK: - Activity Chart

    private var activityChart: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Activity (Last 14 Days)")
                .sectionHeader()

            Chart(viewModel.chartData, id: \.date) { entry in
                BarMark(
                    x: .value("Date", entry.date, unit: .day),
                    y: .value("Hours", entry.hours)
                )
                .foregroundStyle(
                    Calendar.current.isDateInToday(entry.date)
                        ? Color.blue
                        : Color.blue.opacity(0.4)
                )
                .cornerRadius(3)
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: 2)) { value in
                    AxisGridLine()
                    AxisValueLabel(format: .dateTime.weekday(.abbreviated))
                }
            }
            .chartYAxis {
                AxisMarks { value in
                    AxisGridLine()
                    AxisValueLabel("\(value.as(Double.self).map { Int($0) } ?? 0)h")
                }
            }
            .frame(height: 160)
        }
        .cardStyle()
    }

    // MARK: - Days List

    private var daysList: some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text("Daily Breakdown")
                .sectionHeader()

            ForEach(viewModel.dailySummaries) { summary in
                HistoryDayRow(summary: summary) {
                    appState.selectedDate = summary.date
                    appState.selectedSection = .today
                }
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: DS.space12) {
            Image(systemName: "chart.bar")
                .font(.system(size: 40))
                .foregroundStyle(.tertiary)
            Text("No history yet")
                .font(.title3.weight(.medium))
            Text("Activity history builds up over days of use.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DS.space32)
    }
}

// MARK: - History Day Row

struct HistoryDayRow: View {
    let summary: DailySummary
    let onTap: () -> Void

    private var dateLabel: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(summary.date) { return "Today" }
        if calendar.isDateInYesterday(summary.date) { return "Yesterday" }
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMM d"
        return formatter.string(from: summary.date)
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: DS.space16) {
                VStack(alignment: .leading, spacing: DS.space4) {
                    Text(dateLabel)
                        .font(.body.weight(.medium))
                    Text("\(summary.appCount) apps · \(summary.sessionCount) sessions")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: DS.space4) {
                    Text(summary.formattedActiveTime)
                        .font(.body.monospacedDigit().weight(.medium))
                    if summary.focusScore > 0 {
                        Text("\(summary.focusScorePercent)% focus")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(DS.space12)
            .background(Color(.controlBackgroundColor), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
        }
        .buttonStyle(.plain)
    }
}
