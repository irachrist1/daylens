import SwiftUI

struct DaySummaryRow: View {
    let summary: DailySummary
    let onTap: () -> Void

    private var dateLabel: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return formatter.string(from: summary.date)
    }

    private var dayOfWeek: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE"
        return formatter.string(from: summary.date)
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: DS.space16) {
                // Date column
                VStack(alignment: .leading, spacing: DS.space2) {
                    Text(dayOfWeek)
                        .font(.body.weight(.medium))
                    Text(dateLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(width: 120, alignment: .leading)

                // Active time
                VStack(alignment: .leading, spacing: DS.space2) {
                    Text(summary.formattedActiveTime)
                        .font(.body.weight(.medium).monospacedDigit())
                    Text("active")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(width: 80, alignment: .leading)

                // Focus score
                HStack(spacing: DS.space4) {
                    Circle()
                        .fill(focusColor)
                        .frame(width: 8, height: 8)
                    Text("\(summary.focusScorePercent)%")
                        .font(.body.monospacedDigit())
                }
                .frame(width: 60, alignment: .leading)

                // Stats
                HStack(spacing: DS.space16) {
                    statPill(icon: "square.grid.2x2", value: "\(summary.appCount)")
                    statPill(icon: "globe", value: "\(summary.domainCount)")
                    statPill(icon: "arrow.triangle.swap", value: "\(summary.contextSwitches)")
                }

                Spacer()

                // AI summary indicator
                if summary.aiSummary != nil {
                    Image(systemName: "sparkles")
                        .font(.caption)
                        .foregroundStyle(.accent)
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

    private var focusColor: Color {
        switch summary.focusScore {
        case 0.7...: return .green
        case 0.4..<0.7: return .orange
        default: return .red
        }
    }

    private func statPill(icon: String, value: String) -> some View {
        HStack(spacing: DS.space2) {
            Image(systemName: icon)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }
}
