import SwiftUI

/// A compact density visualization showing activity intensity over the hours of a day.
/// Each hour segment's opacity/color reflects the amount of active usage.
struct DensityStrip: View {
    let hourlyActivity: [HourlyBucket]

    struct HourlyBucket: Identifiable {
        let id: Int // hour 0-23
        let activeMinutes: Double
        let dominantCategory: ActivityCategory
    }

    private var maxMinutes: Double {
        hourlyActivity.map(\.activeMinutes).max() ?? 60
    }

    var body: some View {
        HStack(spacing: 1) {
            ForEach(0..<24, id: \.self) { hour in
                let bucket = hourlyActivity.first { $0.id == hour }
                DensitySegment(
                    activeMinutes: bucket?.activeMinutes ?? 0,
                    maxMinutes: maxMinutes,
                    category: bucket?.dominantCategory ?? .uncategorized,
                    hour: hour
                )
            }
        }
        .frame(height: Theme.densityStripHeight)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))
    }
}

struct DensitySegment: View {
    let activeMinutes: Double
    let maxMinutes: Double
    let category: ActivityCategory
    let hour: Int

    private var intensity: Double {
        guard maxMinutes > 0 else { return 0 }
        return min(1.0, activeMinutes / maxMinutes)
    }

    var body: some View {
        Rectangle()
            .fill(
                intensity > 0
                    ? Theme.Colors.category(category).opacity(0.2 + intensity * 0.8)
                    : Theme.Colors.separator.opacity(0.3)
            )
            .help("\(hour):00 — \(Int(activeMinutes))m active")
    }
}

/// Density strip with time labels beneath.
struct LabeledDensityStrip: View {
    let hourlyActivity: [DensityStrip.HourlyBucket]

    var body: some View {
        VStack(spacing: Theme.spacing2) {
            DensityStrip(hourlyActivity: hourlyActivity)

            HStack {
                ForEach([0, 6, 12, 18, 23], id: \.self) { hour in
                    if hour > 0 { Spacer() }
                    Text("\(hour):00")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Colors.tertiaryText)
                    if hour < 23 { Spacer() }
                }
            }
        }
    }
}
