import SwiftUI

/// Shows the confidence level of a tracking attribution.
/// Transparent to the user about data quality.
struct ConfidenceBadge: View {
    let confidence: Double

    private var label: String {
        switch confidence {
        case 0.8...: return "High"
        case 0.5..<0.8: return "Medium"
        default: return "Low"
        }
    }

    private var color: Color {
        switch confidence {
        case 0.8...: return Theme.Colors.focus
        case 0.5..<0.8: return Theme.Colors.warning
        default: return Theme.Colors.distraction
        }
    }

    private var icon: String {
        switch confidence {
        case 0.8...: return "checkmark.circle.fill"
        case 0.5..<0.8: return "questionmark.circle.fill"
        default: return "exclamationmark.circle.fill"
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: icon)
                .font(.system(size: 8))
            Text(label)
                .font(Theme.Typography.caption)
        }
        .foregroundStyle(color)
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(color.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .help("Tracking confidence: \(Int(confidence * 100))%")
    }
}
