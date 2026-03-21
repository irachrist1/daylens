import SwiftUI

/// Horizontal usage bar showing relative time for an item.
/// Progress line has a subtle outer glow — "self-illuminated" on dark.
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
                    .foregroundStyle(DS.onSurface)
                    .lineLimit(1)

                Spacer()

                Text(formattedDuration)
                    .font(.body.monospacedDigit())
                    .foregroundStyle(DS.onSurfaceVariant)
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    // Track
                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(color.opacity(0.10))
                        .frame(height: 5)

                    // Fill with subtle glow
                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(color)
                        .frame(width: geometry.size.width * fraction, height: 5)
                        .shadow(color: color.opacity(0.45), radius: 3, x: 0, y: 0)
                }
            }
            .frame(height: 5)

            if let subtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
            }
        }
        .padding(.vertical, DS.space4)
    }
}
