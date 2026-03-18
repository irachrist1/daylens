import SwiftUI

/// A subtle "density strip" that shows activity intensity across a day —
/// hour columns colored by activity amount. Used in Today and History views.
struct DensityStripView: View {
    /// 24 values, one per hour, representing active seconds in that hour.
    let hourlySeconds: [Double]
    let height: CGFloat

    private var maxSeconds: Double { hourlySeconds.max() ?? 1 }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<24, id: \.self) { hour in
                let seconds = hour < hourlySeconds.count ? hourlySeconds[hour] : 0
                let intensity = maxSeconds > 0 ? seconds / maxSeconds : 0

                RoundedRectangle(cornerRadius: 2)
                    .fill(stripColor(intensity: intensity))
                    .frame(maxWidth: .infinity)
                    .frame(height: height)
                    .help("\(hourLabel(hour)): \(seconds.shortDurationString)")
            }
        }
    }

    private func stripColor(intensity: Double) -> Color {
        if intensity <= 0 { return Color.secondary.opacity(0.08) }
        // Ramp from muted accent to full accent
        return Color.dlAccent.opacity(0.15 + intensity * 0.75)
    }

    private func hourLabel(_ hour: Int) -> String {
        let h = hour % 12 == 0 ? 12 : hour % 12
        let ampm = hour < 12 ? "AM" : "PM"
        return "\(h) \(ampm)"
    }
}

// MARK: - Hourly computation helper

extension DailyAggregator {
    /// Returns an array of 24 Doubles representing active seconds per hour for the given dateKey.
    func hourlyActivitySeconds(for dateKey: String) throws -> [Double] {
        var buckets = [Double](repeating: 0, count: 24)
        let sessions = try timelineSegments(for: dateKey)

        for session in sessions {
            guard let end = session.endDate else { continue }
            let start = session.startDate

            var current = start
            while current < end {
                let hour = Calendar.current.component(.hour, from: current)
                let nextHour = Calendar.current.date(
                    byAdding: .hour, value: 1,
                    to: Calendar.current.startOfHour(for: current)
                )!
                let segmentEnd = min(end, nextHour)
                buckets[hour] += segmentEnd.timeIntervalSince(current)
                current = nextHour
            }
        }
        return buckets
    }
}

extension Calendar {
    func startOfHour(for date: Date) -> Date {
        let comps = dateComponents([.year, .month, .day, .hour], from: date)
        return self.date(from: comps) ?? date
    }
}
