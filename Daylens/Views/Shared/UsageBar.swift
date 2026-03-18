import SwiftUI

/// Horizontal usage bar showing relative time for an item.
struct UsageBar: View {
    let label: String
    let duration: TimeInterval
    let maxDuration: TimeInterval
    let color: Color
    var subtitle: String?

    private var fraction: Double {
        guard maxDuration > 0 else { return 0 }
        return min(duration / maxDuration, 1.0)
    }

    private var formattedDuration: String {
        let hours = Int(duration) / 3600
        let minutes = (Int(duration) % 3600) / 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        if minutes > 0 { return "\(minutes)m" }
        return "<1m"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space4) {
            HStack {
                Text(label)
                    .font(.body)
                    .lineLimit(1)

                Spacer()

                Text(formattedDuration)
                    .font(.body.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(color.opacity(0.12))
                        .frame(height: 6)

                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(color)
                        .frame(width: geometry.size.width * fraction, height: 6)
                }
            }
            .frame(height: 6)

            if let subtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, DS.space4)
    }
}
