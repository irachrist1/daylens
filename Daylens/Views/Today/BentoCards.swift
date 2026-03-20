import SwiftUI

// MARK: - Focus Ring Card

/// Circular focus-score ring with percentage readout.
struct FocusRingCard: View {
    let ratio: Double   // 0–1
    let scoreText: String

    private let ringSize: CGFloat = 80
    private let lineWidth: CGFloat = 8

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Focus Score")
                .sectionHeader()

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

                Text(scoreText)
                    .font(.system(size: 18, weight: .bold, design: .default).monospacedDigit())
                    .foregroundStyle(DS.onSurface)
                    .tracking(-0.5)
            }
        }
        .cardStyle()
    }
}

// MARK: - Weekly Sparkline Card

/// 7-day focus score bar chart.
/// Answers one question at a glance: how does today compare to the rest of the week?
/// - Today's bar is highlighted with its % label; other bars are unlabelled.
/// - The header shows the weekly average as a quiet reference number.
/// - A single takeaway line ("Best day this week", "Above avg", "Below avg") gives
///   the conclusion so the user never has to calculate it.
struct WeeklySparklineCard: View {
    let days: [DaySummarySnapshot]

    /// Always returns Mon–Sun of the current ISO week, zero-filling days with no data.
    /// Future days appear as flat empty bars; today is highlighted.
    private var weekGrid: [DaySummarySnapshot] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        // Apple weekday: 1=Sun, 2=Mon, …, 7=Sat
        let weekday = calendar.component(.weekday, from: today)
        let daysFromMonday = (weekday - 2 + 7) % 7
        let monday = calendar.date(byAdding: .day, value: -daysFromMonday, to: today) ?? today
        let byDate = Dictionary(days.map { (calendar.startOfDay(for: $0.date), $0) },
                                uniquingKeysWith: { first, _ in first })
        return (0..<7).map { offset in
            let day = calendar.date(byAdding: .day, value: offset, to: monday) ?? today
            return byDate[day] ?? DaySummarySnapshot(
                date: day, totalActiveTime: 0, appCount: 0,
                topAppName: nil, topAppBundleID: nil
            )
        }
    }

    private var maxTime: TimeInterval {
        weekGrid.map(\.totalActiveTime).max().flatMap { $0 > 0 ? $0 : nil } ?? 1
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space10) {
            Text("This Week")
                .sectionHeader()

            HStack(alignment: .bottom, spacing: DS.space6) {
                ForEach(weekGrid) { day in
                    SparklineBar(activeTime: day.totalActiveTime, maxTime: maxTime, date: day.date)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 80)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .cardStyle()
    }
}

private struct SparklineBar: View {
    let activeTime: TimeInterval
    let maxTime: TimeInterval
    let date: Date

    @State private var appeared = false

    private var isToday: Bool { Calendar.current.isDateInToday(date) }
    private var ratio: Double { maxTime > 0 ? min(1, activeTime / maxTime) : 0 }
    private var barHeight: CGFloat { activeTime > 0 ? max(8, CGFloat(ratio) * 56) : 3 }

    private var formattedTime: String {
        let hours = Int(activeTime) / 3600
        let mins = (Int(activeTime) % 3600) / 60
        return hours > 0 ? "\(hours)h" : "\(mins)m"
    }

    private var dayLabel: String {
        let labels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
        let weekday = Calendar.current.component(.weekday, from: date)
        return labels[(weekday - 1) % 7]
    }

    var body: some View {
        VStack(spacing: 2) {
            Text(activeTime > 0 ? formattedTime : " ")
                .font(.system(size: 10, weight: .bold).monospacedDigit())
                .foregroundStyle(isToday ? DS.primary : DS.onSurfaceVariant.opacity(0.6))
                .lineLimit(1)

            VStack {
                Spacer(minLength: 0)
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(isToday ? DS.primary : DS.primary.opacity(activeTime > 0 ? 0.3 : 0.08))
                    .frame(height: appeared ? barHeight : 2)
                    .shadow(color: isToday ? DS.primary.opacity(0.4) : .clear, radius: 4)
                    .animation(.spring(response: 0.5, dampingFraction: 0.75).delay(0.04), value: appeared)
            }
            .frame(maxWidth: .infinity)

            Text(isToday ? "●" : dayLabel)
                .font(.system(size: isToday ? 8 : 10, weight: isToday ? .bold : .regular))
                .foregroundStyle(isToday ? DS.primary : DS.onSurfaceVariant.opacity(0.5))
        }
        .frame(maxWidth: .infinity)
        .help("\(dayLabel)\(isToday ? " (today)" : "") — \(formattedTime)")
        .onAppear { appeared = true }
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
                        .font(.caption)
                        .foregroundStyle(DS.onSurfaceVariant.opacity(0.8))
                }
            }
            if categories.count > 4 {
                Text("+\(categories.count - 4)")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.4))
            }
            Spacer()
        }
    }
}

// MARK: - App Real Icon

/// Resolves the real macOS app icon via NSWorkspace using the bundle ID.
/// Falls back to AppInitialsIcon if the bundle cannot be located.
struct AppRealIcon: View {
    let bundleID: String
    let name: String
    let category: AppCategory
    let size: CGFloat

    @State private var icon: NSImage? = nil

    var body: some View {
        Group {
            if let icon {
                Image(nsImage: icon)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
            } else {
                AppInitialsIcon(name: name, category: category, size: size)
            }
        }
        .onAppear {
            guard icon == nil, !bundleID.isEmpty else { return }
            if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
                icon = NSWorkspace.shared.icon(forFile: url.path)
            }
        }
        .onChange(of: bundleID) { _, newBundleID in
            icon = nil
            guard !newBundleID.isEmpty else { return }
            if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: newBundleID) {
                icon = NSWorkspace.shared.icon(forFile: url.path)
            }
        }
    }
}

// MARK: - App Initials Icon

/// Colored rounded square with 2-letter initials — fallback when no real icon is available.
struct AppInitialsIcon: View {
    let name: String
    let category: AppCategory
    let size: CGFloat

    private var initials: String {
        let words = name.split(separator: " ")
        if words.count >= 2 {
            return String(words[0].prefix(1) + words[1].prefix(1)).uppercased()
        }
        return String(name.prefix(2)).uppercased()
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                .fill(DS.categoryColor(for: category).opacity(0.18))
                .frame(width: size, height: size)
            Text(initials)
                .font(.system(size: size * 0.34, weight: .semibold))
                .foregroundStyle(DS.categoryColor(for: category))
        }
    }
}

// MARK: - Category Badge

/// Inline pill showing category name with category color background.
struct CategoryBadge: View {
    let category: AppCategory

    var body: some View {
        Text(category.rawValue.uppercased())
            .font(.system(size: 9, weight: .semibold))
            .tracking(0.5)
            .foregroundStyle(DS.categoryColor(for: category))
            .padding(.horizontal, DS.space6)
            .padding(.vertical, 2)
            .background(
                DS.categoryColor(for: category).opacity(0.12),
                in: Capsule(style: .continuous)
            )
    }
}

// MARK: - Recent Sessions Card

/// Replaces TopAppsCard with initials icons and efficiency dots.
struct RecentSessionsCard: View {
    let summaries: [AppUsageSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Recent Sessions")
                .sectionHeader()

            if summaries.isEmpty {
                Text("No sessions yet")
                    .font(.body)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
            } else {
                ForEach(summaries.prefix(5)) { app in
                    SessionRow(app: app)
                }
            }
        }
        .cardStyle()
    }
}

private struct SessionRow: View {
    let app: AppUsageSummary

    var body: some View {
        HStack(spacing: DS.space12) {
            AppRealIcon(bundleID: app.bundleID, name: app.appName, category: app.category, size: 36)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: DS.space6) {
                    Text(app.appName)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(DS.onSurface)
                    CategoryBadge(category: app.category)
                }
                Text(app.formattedDuration)
                    .font(.system(size: 13).monospacedDigit())
                    .foregroundStyle(DS.onSurfaceVariant)
            }

            Spacer()

            // Efficiency dots
            HStack(spacing: 3) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(i < efficiencyDots(for: app) ? DS.categoryColor(for: app.category) : DS.surfaceHighest)
                        .frame(width: 6, height: 6)
                }
            }
        }
    }

    // Simple heuristic: 3 dots if >1h, 2 dots if >30m, 1 dot otherwise
    private func efficiencyDots(for app: AppUsageSummary) -> Int {
        app.totalDuration > 3600 ? 3 : app.totalDuration > 1800 ? 2 : 1
    }
}

// MARK: - Intelligence Insight Card

/// Heuristic-based insight card with optimization score.
struct IntelligenceInsightCard: View {
    let focusScore: Int
    let topCategory: AppCategory?
    let totalSeconds: TimeInterval

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack(spacing: DS.space8) {
                Image(systemName: "lightbulb.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(DS.secondary)
                Text("Intelligence Insight")
                    .sectionHeader()
            }

            Text(insightTitle)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(DS.onSurface)

            Text(insightBody)
                .font(.system(size: 13))
                .foregroundStyle(DS.onSurfaceVariant)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: DS.space6) {
                HStack {
                    Text("OPTIMIZATION SCORE")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(DS.onSurfaceVariant)
                    Spacer()
                    Text("\(focusScore)/100")
                        .font(.system(size: 12, weight: .semibold).monospacedDigit())
                        .foregroundStyle(DS.primary)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(DS.surfaceHighest)
                        Capsule()
                            .fill(DS.primaryGradient)
                            .frame(width: geo.size.width * Double(focusScore) / 100)
                    }
                }
                .frame(height: 5)
            }
        }
        .cardStyle()
    }

    private var insightTitle: String {
        if focusScore >= 75 { return "Focus Peak Detected" }
        if focusScore >= 50 { return "Steady Progress" }
        return "Focus Opportunity"
    }

    private var insightBody: String {
        guard let cat = topCategory else {
            return "Start using your Mac and insights will appear here."
        }
        let hours = Int(totalSeconds) / 3600
        let mins = (Int(totalSeconds) % 3600) / 60
        let timeStr = hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
        if focusScore >= 75 {
            return "Your cognitive load is optimized today with \(timeStr) in \(cat.rawValue). This is your peak performance window."
        }
        if focusScore >= 50 {
            return "You've spent \(timeStr) in \(cat.rawValue). Consider blocking distractions to boost your score."
        }
        return "Only \(timeStr) of focused work detected. Scheduling a focus block could improve output by 20%+."
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
                .font(.system(.callout, design: .default, weight: .medium))
                .foregroundStyle(DS.onSurfaceVariant)

            Text(totalActiveTime)
                .font(.system(size: 48, weight: .bold, design: .default).monospacedDigit())
                .foregroundStyle(DS.onSurface)
                .tracking(-1.5)

            Text("active today")
                .font(.callout)
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
                .font(.caption.weight(.semibold))
                .foregroundStyle(color)
            Text(label)
                .font(.callout.weight(.medium))
                .foregroundStyle(DS.onSurface.opacity(0.8))
        }
        .padding(.horizontal, DS.space10)
        .padding(.vertical, DS.space4)
        .background(Color.white.opacity(0.08), in: Capsule(style: .continuous))
    }
}
