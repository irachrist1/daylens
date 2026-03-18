import SwiftUI

/// Horizontal activity timeline showing the day's sessions as colored segments.
struct TimelineBand: View {
    let sessions: [AppSession]

    private let dayStartHour = 6  // Start at 6 AM
    private let dayEndHour = 24   // End at midnight
    private let bandHeight: CGFloat = 40

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text("Activity Timeline")
                .sectionHeader()

            GeometryReader { geometry in
                let totalWidth = geometry.size.width
                let totalHours = CGFloat(dayEndHour - dayStartHour)

                ZStack(alignment: .leading) {
                    // Background
                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(Color(.controlBackgroundColor))

                    // Hour markers
                    ForEach(dayStartHour..<dayEndHour, id: \.self) { hour in
                        let x = CGFloat(hour - dayStartHour) / totalHours * totalWidth
                        Rectangle()
                            .fill(Color(.separatorColor))
                            .frame(width: 0.5)
                            .offset(x: x)
                    }

                    // Session segments
                    ForEach(sessions) { session in
                        sessionSegment(session, totalWidth: totalWidth, totalHours: totalHours)
                    }
                }
                .frame(height: bandHeight)
                .clipShape(RoundedRectangle(cornerRadius: DS.radiusSmall))

                // Hour labels
                HStack(spacing: 0) {
                    ForEach([6, 9, 12, 15, 18, 21], id: \.self) { hour in
                        Text(hourLabel(hour))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .offset(y: bandHeight + 4)
            }
            .frame(height: bandHeight + 20)
        }
        .cardStyle()
    }

    private func sessionSegment(_ session: AppSession, totalWidth: CGFloat, totalHours: CGFloat) -> some View {
        let calendar = Calendar.current
        let startHour = CGFloat(calendar.component(.hour, from: session.startTime))
            + CGFloat(calendar.component(.minute, from: session.startTime)) / 60.0
        let endHour = CGFloat(calendar.component(.hour, from: session.endTime))
            + CGFloat(calendar.component(.minute, from: session.endTime)) / 60.0

        let clampedStart = max(CGFloat(dayStartHour), startHour)
        let clampedEnd = min(CGFloat(dayEndHour), endHour)

        let x = (clampedStart - CGFloat(dayStartHour)) / totalHours * totalWidth
        let width = max(2, (clampedEnd - clampedStart) / totalHours * totalWidth)

        return RoundedRectangle(cornerRadius: 2)
            .fill(DS.categoryColor(for: session.category).opacity(0.8))
            .frame(width: width, height: bandHeight - 8)
            .offset(x: x, y: 4)
            .help("\(session.appName) — \(session.formattedDuration)")
    }

    private func hourLabel(_ hour: Int) -> String {
        if hour == 12 { return "12p" }
        if hour > 12 { return "\(hour - 12)p" }
        return "\(hour)a"
    }
}
