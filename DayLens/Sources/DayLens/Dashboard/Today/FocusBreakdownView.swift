import SwiftUI

/// Visual focus score meter with qualitative label.
struct FocusBreakdownView: View {
    let focusScore: Double  // 0.0 – 1.0

    private var label: String {
        switch focusScore {
        case 0.8...: return "Highly focused"
        case 0.6..<0.8: return "Mostly focused"
        case 0.4..<0.6: return "Mixed"
        case 0.2..<0.4: return "Fragmented"
        default: return "Very fragmented"
        }
    }

    private var color: Color {
        switch focusScore {
        case 0.6...: return .dlFocusGreen
        case 0.3..<0.6: return .dlWarningAmber
        default: return Color(NSColor.systemRed).opacity(0.8)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                Text("Focus")
                    .font(DLTypography.headingSmall)
            }

            HStack(spacing: 16) {
                // Score arc / gauge
                ZStack {
                    Circle()
                        .stroke(Color.secondary.opacity(0.12), lineWidth: 8)
                    Circle()
                        .trim(from: 0, to: focusScore)
                        .stroke(color, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.easeInOut(duration: 0.6), value: focusScore)
                    Text(String(format: "%.0f%%", focusScore * 100))
                        .font(DLTypography.metricSmall)
                }
                .frame(width: 64, height: 64)

                VStack(alignment: .leading, spacing: 4) {
                    Text(label)
                        .font(DLTypography.headingSmall)
                        .foregroundColor(color)
                    Text("Based on time concentration and context switches")
                        .font(DLTypography.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()
            }
        }
        .padding(16)
        .background(Color(NSColor.controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
    }
}
