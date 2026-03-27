import SwiftUI

/// The time-axis background layer: hour labels on the left + subtle horizontal dividers.
struct TimelineGrid: View {
    let startOfRange: Date
    let endOfRange: Date
    let hourHeight: CGFloat
    let timeAxisWidth: CGFloat

    private var hours: [Date] {
        var result: [Date] = []
        let cal = Calendar.current
        // Find the first whole hour >= startOfRange
        var components = cal.dateComponents([.year, .month, .day, .hour], from: startOfRange)
        components.minute = 0
        components.second = 0
        guard var cursor = cal.date(from: components) else { return result }
        if cursor < startOfRange {
            cursor = cal.date(byAdding: .hour, value: 1, to: cursor) ?? cursor
        }
        while cursor <= endOfRange {
            result.append(cursor)
            cursor = cal.date(byAdding: .hour, value: 1, to: cursor) ?? cursor
        }
        return result
    }

    private var totalSeconds: TimeInterval {
        max(1, endOfRange.timeIntervalSince(startOfRange))
    }

    var totalHeight: CGFloat {
        CGFloat(totalSeconds / 3600) * hourHeight
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
                .frame(height: totalHeight)

            ForEach(hours, id: \.self) { hour in
                let yOffset = CGFloat(hour.timeIntervalSince(startOfRange) / 3600) * hourHeight

                // Hour label
                Text(Self.formatHour(hour))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
                    .frame(width: timeAxisWidth - DS.space8, alignment: .trailing)
                    .offset(x: 0, y: yOffset - 8)

                // Grid line
                Rectangle()
                    .fill(DS.outlineVariant.opacity(0.65))
                    .frame(maxWidth: .infinity, minHeight: 1, maxHeight: 1)
                    .offset(x: timeAxisWidth, y: yOffset)
            }
        }
    }

    private static func formatHour(_ date: Date) -> String {
        let hour = Calendar.current.component(.hour, from: date)
        switch hour {
        case 0:  return "12 AM"
        case 12: return "12 PM"
        case 1..<12: return "\(hour) AM"
        default: return "\(hour - 12) PM"
        }
    }
}
