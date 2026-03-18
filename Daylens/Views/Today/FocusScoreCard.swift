import SwiftUI

/// Card displaying the focus score with a circular gauge.
struct FocusScoreCard: View {
    let summary: DailySummary?

    private var score: Double {
        summary?.focusScore ?? 0
    }

    var body: some View {
        VStack(spacing: DS.space12) {
            Text("Focus Score")
                .sectionHeader()

            ZStack {
                Circle()
                    .stroke(Color(.controlBackgroundColor), lineWidth: 8)

                Circle()
                    .trim(from: 0, to: score)
                    .stroke(scoreColor, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut, value: score)

                VStack(spacing: DS.space2) {
                    Text("\(Int(score * 100))%")
                        .font(.title2.weight(.bold).monospacedDigit())

                    Text(summary?.focusScoreLabel ?? "No data")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 100, height: 100)

            if let summary {
                VStack(spacing: DS.space4) {
                    HStack {
                        Text("Context switches")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("\(summary.contextSwitches)")
                            .font(.caption.monospacedDigit())
                    }

                    HStack {
                        Text("Longest streak")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(formatDuration(summary.longestFocusStreak))
                            .font(.caption.monospacedDigit())
                    }
                }
            }
        }
        .cardStyle()
    }

    private var scoreColor: Color {
        switch score {
        case 0.7...: return .green
        case 0.4..<0.7: return .orange
        default: return .red
        }
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds) / 60
        if minutes >= 60 {
            return "\(minutes / 60)h \(minutes % 60)m"
        }
        return "\(minutes)m"
    }
}
