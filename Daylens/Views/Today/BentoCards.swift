import SwiftUI

// MARK: - Focus Ring Card

/// Circular focus-score ring with percentage readout.
struct FocusRingCard: View {
    let ratio: Double   // 0–1
    let label: String
    let scoreText: String

    private let ringSize: CGFloat = 110
    private let lineWidth: CGFloat = 10

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Focus Score")
                .sectionHeader()

            HStack(spacing: DS.space20) {
                // Ring
                ZStack {
                    Circle()
                        .stroke(DS.surfaceHighest, lineWidth: lineWidth)
                        .frame(width: ringSize, height: ringSize)

                    Circle()
                        .trim(from: 0, to: ratio)
                        .stroke(
                            AngularGradient(
                                colors: [DS.primary.opacity(0.6), DS.primary],
                                center: .center,
                                startAngle: .degrees(-90),
                                endAngle: .degrees(-90 + 360 * ratio)
                            ),
                            style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                        )
                        .frame(width: ringSize, height: ringSize)
                        .rotationEffect(.degrees(-90))
                        .shadow(color: DS.primary.opacity(0.4), radius: 6, x: 0, y: 0)
                        .animation(.easeOut(duration: 0.8), value: ratio)

                    VStack(spacing: 2) {
                        Text(scoreText)
                            .font(.system(size: 22, weight: .bold, design: .default).monospacedDigit())
                            .foregroundStyle(DS.onSurface)
                            .tracking(-0.5)

                        Text(label)
                            .font(.caption2)
                            .foregroundStyle(DS.onSurfaceVariant.opacity(0.7))
                    }
                }

                // Streak info if available
                VStack(alignment: .leading, spacing: DS.space6) {
                    scoreRow(
                        icon: "flame.fill",
                        color: DS.secondary,
                        label: label
                    )
                    scoreRow(
                        icon: "chart.line.uptrend.xyaxis",
                        color: DS.tertiary,
                        label: ratio > 0 ? "Today's score" : "No data yet"
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .cardStyle()
    }

    private func scoreRow(icon: String, color: Color, label: String) -> some View {
        HStack(spacing: DS.space6) {
            Image(systemName: icon)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(color)
                .frame(width: 16)

            Text(label)
                .font(.caption)
                .foregroundStyle(DS.onSurfaceVariant)
        }
    }
}

// MARK: - Weekly Sparkline Card

/// 7-day sparkline of focus scores as a bar chart.
struct WeeklySparklineCard: View {
    let days: [DailySummary]

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("This Week")
                .sectionHeader()

            if days.isEmpty {
                Text("Build up your history to see weekly trends.")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, DS.space20)
            } else {
                HStack(alignment: .bottom, spacing: DS.space6) {
                    ForEach(days.reversed()) { day in
                        SparklineBar(
                            score: day.focusScore,
                            date: day.date,
                            activeTime: day.formattedActiveTime
                        )
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 64)
            }
        }
        .cardStyle()
    }
}

private struct SparklineBar: View {
    let score: Double
    let date: Date
    let activeTime: String

    @State private var appeared = false

    private var isToday: Bool {
        Calendar.current.isDateInToday(date)
    }

    private var barHeight: CGFloat {
        max(4, CGFloat(score) * 60)
    }

    var body: some View {
        VStack(spacing: DS.space4) {
            Text(dayLabel)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(isToday ? DS.primary : DS.onSurfaceVariant.opacity(0.4))

            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(isToday ? DS.primary : DS.primary.opacity(0.35))
                .frame(height: appeared ? barHeight : 0)
                .shadow(color: isToday ? DS.primary.opacity(0.5) : .clear, radius: 4, x: 0, y: 0)
                .animation(.spring(response: 0.5, dampingFraction: 0.7).delay(0.05), value: appeared)
        }
        .frame(maxWidth: .infinity, alignment: .bottom)
        .help("\(dayLabel) — \(activeTime) active, \(Int(score * 100))% focus")
        .onAppear { appeared = true }
    }

    private var dayLabel: String {
        if isToday { return "T" }
        let f = DateFormatter()
        f.dateFormat = "E"
        return String(f.string(from: date).prefix(1))
    }
}

// MARK: - Time Allocation Bar

/// Horizontally stacked proportional bar of time by category.
struct AllocationBarCard: View {
    let categories: [CategoryUsageSummary]

    private var total: Double {
        categories.reduce(0) { $0 + $1.totalDuration }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Time Allocation")
                .sectionHeader()

            if categories.isEmpty || total <= 0 {
                Text("No data yet.")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
            } else {
                allocationBar
                legendRow
            }
        }
        .cardStyle()
    }

    private var allocationBar: some View {
        GeometryReader { geo in
            HStack(spacing: 2) {
                ForEach(categories) { cat in
                    let fraction = total > 0 ? cat.totalDuration / total : 0
                    let color = DS.categoryColor(for: cat.category)
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(color)
                        .frame(width: max(4, geo.size.width * fraction))
                        .help("\(cat.category.rawValue) — \(cat.formattedDuration)")
                }
            }
        }
        .frame(height: 12)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private var legendRow: some View {
        HStack(spacing: DS.space8) {
            ForEach(categories.prefix(4)) { cat in
                let color = DS.categoryColor(for: cat.category)
                HStack(spacing: DS.space4) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(color)
                        .frame(width: 8, height: 8)
                    Text(cat.category.legendLabel)
                        .font(.caption2)
                        .foregroundStyle(DS.onSurfaceVariant.opacity(0.8))
                }
            }
            if categories.count > 4 {
                Text("+\(categories.count - 4)")
                    .font(.caption2)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.4))
            }
            Spacer()
        }
    }
}

// MARK: - Hero Summary Card

/// Hero-style banner: big active time + greeting subtext.
struct HeroSummaryCard: View {
    let greeting: String
    let totalActiveTime: String
    let appCount: Int
    let siteCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text(greeting)
                .font(.system(.subheadline, design: .default, weight: .medium))
                .foregroundStyle(DS.onSurfaceVariant)

            Text(totalActiveTime)
                .font(.system(size: 48, weight: .bold, design: .default).monospacedDigit())
                .foregroundStyle(DS.onSurface)
                .tracking(-1.5)

            Text("active today")
                .font(.subheadline)
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.7))

            HStack(spacing: DS.space16) {
                pill(icon: "square.grid.2x2.fill", label: "\(appCount) apps", color: DS.secondary)
                pill(icon: "globe", label: "\(siteCount) sites", color: DS.primary)
            }
            .padding(.top, DS.space4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DS.space20)
        .background(DS.heroGradient, in: RoundedRectangle(cornerRadius: DS.radiusXL, style: .continuous))
    }

    private func pill(icon: String, label: String, color: Color) -> some View {
        HStack(spacing: DS.space6) {
            Image(systemName: icon)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(color)
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundStyle(DS.onSurface.opacity(0.8))
        }
        .padding(.horizontal, DS.space10)
        .padding(.vertical, DS.space4)
        .background(Color.white.opacity(0.08), in: Capsule(style: .continuous))
    }
}
