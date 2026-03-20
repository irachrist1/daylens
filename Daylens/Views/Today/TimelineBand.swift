import SwiftUI

/// Horizontal activity timeline showing the day's sessions as colored segments.
struct TimelineBand: View {
    let sessions: [AppSession]
    let categorySummaries: [CategoryUsageSummary]

    private let dayStartHour = 6
    private let dayEndHour = 24
    private let bandHeight: CGFloat = 40

    init(sessions: [AppSession], categorySummaries: [CategoryUsageSummary] = []) {
        self.sessions = sessions
        self.categorySummaries = categorySummaries
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text("Activity Timeline")
                .sectionHeader()

            GeometryReader { geometry in
                let totalWidth = geometry.size.width
                let totalHours = CGFloat(dayEndHour - dayStartHour)

                ZStack(alignment: .leading) {
                    // Track background
                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(DS.surfaceHighest)

                    // Hour markers — ghost lines at low opacity
                    ForEach(dayStartHour..<dayEndHour, id: \.self) { hour in
                        let x = CGFloat(hour - dayStartHour) / totalHours * totalWidth
                        Rectangle()
                            .fill(Color.white.opacity(0.05))
                            .frame(width: 0.5)
                            .offset(x: x)
                    }

                    // Session segments with subtle glow
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
                            .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .offset(y: bandHeight + 4)
            }
            .frame(height: bandHeight + 20)

            if !categorySummaries.isEmpty {
                legendRow
            }
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

        let classification = session.classification
        var helpLines = ["\(session.appName) — \(session.formattedDuration)"]
        helpLines.append("Category: \(classification.category.rawValue)")
        if let semanticLabel = classification.semanticLabel {
            helpLines.append("Type: \(semanticLabel)")
        }
        if !classification.confidence.isHighConfidence {
            helpLines.append("Category confidence: \(classification.confidence.rawValue)")
        }

        let color = DS.categoryColor(for: classification.category)
        return RoundedRectangle(cornerRadius: 2)
            .fill(color.opacity(0.85))
            .frame(width: width, height: bandHeight - 8)
            .shadow(color: color.opacity(0.5), radius: 2, x: 0, y: 0)
            .offset(x: x, y: 4)
            .help(helpLines.joined(separator: "\n"))
    }

    private func hourLabel(_ hour: Int) -> String {
        if hour == 12 { return "12p" }
        if hour > 12 { return "\(hour - 12)p" }
        return "\(hour)a"
    }

    private var legendRow: some View {
        VStack(alignment: .leading, spacing: DS.space6) {
            Text("Colors reflect activity type")
                .font(.caption)
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))

            FlowLegend(categories: categorySummaries)
        }
    }
}

private struct FlowLegend: View {
    let categories: [CategoryUsageSummary]

    var body: some View {
        HStack(spacing: DS.space8) {
            ForEach(Array(categories.prefix(5))) { summary in
                let color = DS.categoryColor(for: summary.category)
                HStack(spacing: DS.space4) {
                    Circle()
                        .fill(color)
                        .frame(width: 6, height: 6)
                        .shadow(color: color.opacity(0.6), radius: 2)

                    Text(summary.category.legendLabel)
                        .font(.caption2)
                        .foregroundStyle(DS.onSurfaceVariant)
                }
                .padding(.horizontal, DS.space8)
                .padding(.vertical, DS.space4)
                .background(
                    Capsule(style: .continuous)
                        .fill(color.opacity(0.12))
                )
                .help(legendHelp(for: summary))
            }
        }
    }

    private func legendHelp(for summary: CategoryUsageSummary) -> String {
        var lines = [
            "\(summary.category.rawValue) — \(summary.formattedDuration)",
            "Top apps: \(summary.topApps.joined(separator: ", "))"
        ]
        if summary.containsLowConfidenceApps {
            lines.append("Includes some low-confidence categorizations")
        }
        return lines.joined(separator: "\n")
    }
}
