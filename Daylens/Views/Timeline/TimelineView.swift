import SwiftUI

/// Vertical proportionally-scaled calendar timeline for a day's work context blocks.
struct TimelineView: View {
    let blocks: [WorkContextBlock]
    let date: Date
    var scrollAnchor: UnitPoint = .top

    private let hourHeight: CGFloat = 80
    private let timeAxisWidth: CGFloat = 52
    private let rangePadding: TimeInterval = 30 * 60   // 30 min padding on each end

    // MARK: - Computed range

    private var rangeStart: Date {
        guard let earliest = blocks.map(\.startTime).min() else { return date }
        return earliest.addingTimeInterval(-rangePadding)
    }

    private var rangeEnd: Date {
        guard let latest = blocks.map(\.endTime).max() else { return date }
        return latest.addingTimeInterval(rangePadding)
    }

    private var totalHeight: CGFloat {
        let seconds = rangeEnd.timeIntervalSince(rangeStart)
        return CGFloat(seconds / 3600) * hourHeight
    }

    // MARK: - "Now" position

    private var currentTimeY: CGFloat {
        let y = CGFloat(Date().timeIntervalSince(rangeStart) / 3600) * hourHeight
        return min(max(0, y), totalHeight)
    }

    // MARK: - Layout helpers

    private func topOffset(for block: WorkContextBlock) -> CGFloat {
        CGFloat(block.startTime.timeIntervalSince(rangeStart) / 3600) * hourHeight
    }

    private func blockHeight(for block: WorkContextBlock) -> CGFloat {
        max(4, CGFloat(Double(block.duration) / 3600.0) * hourHeight)
    }

    // MARK: - Body

    var body: some View {
        if blocks.isEmpty {
            EmptyStateView(
                icon: "calendar.badge.clock",
                title: "No activity",
                description: "No sessions recorded for this day."
            )
        } else {
            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: true) {
                    GeometryReader { geo in
                        ZStack(alignment: .topLeading) {
                            // Time-axis grid in the background
                            TimelineGrid(
                                startOfRange: rangeStart,
                                endOfRange: rangeEnd,
                                hourHeight: hourHeight,
                                timeAxisWidth: timeAxisWidth
                            )
                            .frame(width: geo.size.width, height: totalHeight)

                            // Blocks overlaid at absolute positions
                            let blockWidth = geo.size.width - timeAxisWidth - DS.space8
                            ForEach(blocks) { block in
                                TimelineBlock(block: block, hourHeight: hourHeight)
                                    .frame(width: max(0, blockWidth), height: blockHeight(for: block))
                                    .offset(x: timeAxisWidth + DS.space4, y: topOffset(for: block))
                            }

                            // "Now" indicator — today only
                            if Calendar.current.isDateInToday(date) {
                                let nowY = currentTimeY
                                Color.clear.frame(height: 0).id("timeline-now")
                                    .offset(y: nowY)
                                Rectangle()
                                    .fill(DS.primary.opacity(0.7))
                                    .frame(width: max(0, geo.size.width - timeAxisWidth - DS.space8), height: 1.5)
                                    .offset(x: timeAxisWidth, y: nowY)
                            }
                        }
                    }
                    .frame(height: totalHeight)
                    .padding(.horizontal, DS.space8)
                    .padding(.vertical, DS.space12)

                    // Bottom anchor — placed after the GeometryReader so it sits at
                    // the correct layout position for ScrollViewReader.scrollTo.
                    Color.clear.frame(height: 0).id("timeline-end")
                }
                .animation(nil, value: blocks.count)
                .onAppear {
                    guard scrollAnchor != .top else { return }
                    Task { @MainActor in
                        proxy.scrollTo("timeline-now", anchor: .center)
                    }
                }
            }
        }
    }
}

// MARK: - Preview

#Preview("Timeline") {
    let cal = Calendar.current
    let today = cal.startOfDay(for: Date())

    func makeDate(h: Int, m: Int) -> Date {
        cal.date(bySettingHour: h, minute: m, second: 0, of: today)!
    }

    func makeBlock(
        start: Date,
        end: Date,
        label: String,
        category: AppCategory,
        apps: [(String, String)],
        isLive: Bool = false
    ) -> WorkContextBlock {
        let sessions = apps.enumerated().map { i, pair in
            AppSession(
                id: Int64(i),
                date: today,
                bundleID: pair.0,
                appName: pair.1,
                startTime: start,
                endTime: end,
                duration: end.timeIntervalSince(start),
                category: category,
                isBrowser: false
            )
        }
        let topApps = apps.map { pair in
            AppUsageSummary(
                bundleID: pair.0,
                appName: pair.1,
                totalDuration: end.timeIntervalSince(start) / Double(apps.count),
                sessionCount: 1,
                category: category,
                isBrowser: false
            )
        }
        return WorkContextBlock(
            id: UUID(),
            startTime: start,
            endTime: end,
            dominantCategory: category,
            categoryDistribution: [category: end.timeIntervalSince(start)],
            ruleBasedLabel: label,
            aiLabel: nil,
            sessions: sessions,
            topApps: topApps,
            websites: [],
            switchCount: apps.count - 1,
            confidence: .high,
            isLive: isLive
        )
    }

    let blocks: [WorkContextBlock] = [
        makeBlock(
            start: makeDate(h: 9, m: 0),
            end: makeDate(h: 11, m: 15),
            label: "Building checkout flow",
            category: .development,
            apps: [("com.apple.dt.Xcode", "Xcode"), ("com.google.Chrome", "Chrome")]
        ),
        makeBlock(
            start: makeDate(h: 11, m: 30),
            end: makeDate(h: 12, m: 15),
            label: "Communication burst",
            category: .communication,
            apps: [("com.tinyspeck.slackmacgap", "Slack"), ("com.apple.mail", "Mail")]
        ),
        makeBlock(
            start: makeDate(h: 13, m: 30),
            end: makeDate(h: 15, m: 10),
            label: "Writing docs",
            category: .writing,
            apps: [("com.apple.TextEdit", "TextEdit")],
            isLive: true
        ),
    ]

    return TimelineView(blocks: blocks, date: today)
        .frame(width: 480, height: 600)
}

#Preview("Empty") {
    TimelineView(blocks: [], date: Date())
        .frame(width: 480, height: 400)
}
