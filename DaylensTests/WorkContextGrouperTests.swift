import XCTest

#if canImport(Daylens)
@testable import Daylens
#else
@testable import DaylensCore
#endif

final class WorkContextGrouperTests: XCTestCase {
    private let day = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_710_000_000))

    func testSimpleIdleGapSplitsIntoTwoBlocks() {
        let sessions = [
            makeSession(
                bundleID: "com.apple.dt.Xcode",
                appName: "Xcode",
                startOffset: 9 * 3600,
                endOffset: (10 * 3600),
                category: .development
            ),
            makeSession(
                bundleID: "com.apple.TextEdit",
                appName: "TextEdit",
                startOffset: (10 * 3600) + (20 * 60),
                endOffset: (10 * 3600) + (50 * 60),
                category: .writing
            ),
        ]

        let blocks = WorkContextGrouper.group(sessions: sessions, websiteSummaries: [])

        XCTAssertEqual(blocks.count, 2)
    }

    func testNoIdleGapKeepsSessionsInOneBlock() {
        let sessions = sequentialSessions(
            entries: [
                ("com.apple.TextEdit", "TextEdit", .writing, false, 45),
                ("com.apple.Notes", "Notes", .writing, false, 30),
            ]
        )

        let blocks = WorkContextGrouper.group(sessions: sessions, websiteSummaries: [])

        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks[0].dominantCategory, .writing)
    }

    func testEmptySessionListReturnsEmptyOutput() {
        let blocks = WorkContextGrouper.group(sessions: [], websiteSummaries: [])

        XCTAssertTrue(blocks.isEmpty)
    }

    func testIdleGapThresholdBoundaryRequiresGreaterThanThreshold() {
        let underThresholdSessions = [
            makeSession(
                bundleID: "com.apple.TextEdit",
                appName: "TextEdit",
                startOffset: 9 * 3600,
                endOffset: (10 * 3600),
                category: .writing
            ),
            makeSession(
                bundleID: "com.apple.TextEdit",
                appName: "TextEdit",
                startOffset: (10 * 3600) + (14 * 60) + 59,
                endOffset: (10 * 3600) + (44 * 60) + 59,
                category: .writing
            ),
        ]

        let overThresholdSessions = [
            makeSession(
                bundleID: "com.apple.TextEdit",
                appName: "TextEdit",
                startOffset: 9 * 3600,
                endOffset: (10 * 3600),
                category: .writing
            ),
            makeSession(
                bundleID: "com.apple.TextEdit",
                appName: "TextEdit",
                startOffset: (10 * 3600) + (15 * 60) + 1,
                endOffset: (10 * 3600) + (45 * 60) + 1,
                category: .writing
            ),
        ]

        XCTAssertEqual(WorkContextGrouper.group(sessions: underThresholdSessions, websiteSummaries: []).count, 1)
        XCTAssertEqual(WorkContextGrouper.group(sessions: overThresholdSessions, websiteSummaries: []).count, 2)
    }

    func testDeveloperTestingStaysAsSingleBlock() {
        let sessions = alternatingSessions(
            entries: [
                ("com.microsoft.VSCode", "VS Code", .development, false, 4),
                ("com.google.Chrome", "Chrome", .browsing, true, 4),
                ("com.microsoft.VSCode", "VS Code", .development, false, 4),
                ("com.google.Chrome", "Chrome", .browsing, true, 4),
                ("com.microsoft.VSCode", "VS Code", .development, false, 4),
                ("com.google.Chrome", "Chrome", .browsing, true, 4),
                ("com.microsoft.VSCode", "VS Code", .development, false, 4),
                ("com.google.Chrome", "Chrome", .browsing, true, 4),
                ("com.microsoft.VSCode", "VS Code", .development, false, 4),
                ("com.google.Chrome", "Chrome", .browsing, true, 4),
            ]
        )

        let blocks = WorkContextGrouper.group(sessions: sessions, websiteSummaries: [])

        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks[0].dominantCategory, .development)
        XCTAssertGreaterThan(blocks[0].switchCount, 5)
    }

    func testCommunicationBurstSplitsIntoThreeBlocks() {
        let sessions = sequentialSessions(
            entries: [
                ("com.apple.dt.Xcode", "Xcode", .development, false, 120),
                ("com.tinyspeck.slackmacgap", "Slack", .communication, false, 15),
                ("com.apple.mail", "Mail", .email, false, 15),
                ("com.apple.dt.Xcode", "Xcode", .development, false, 90),
            ]
        )

        let blocks = WorkContextGrouper.group(sessions: sessions, websiteSummaries: [])

        XCTAssertEqual(blocks.count, 3)
        XCTAssertEqual(blocks[1].dominantCategory, .communication)
        XCTAssertEqual(blocks[1].displayLabel, "Communication")
    }

    func testMeetingBoundaryProducesDedicatedMeetingBlock() {
        let sessions = sequentialSessions(
            entries: [
                ("com.apple.dt.Xcode", "Xcode", .development, false, 90),
                ("us.zoom.xos", "Zoom", .meetings, false, 45),
                ("com.apple.TextEdit", "TextEdit", .writing, false, 60),
            ]
        )

        let blocks = WorkContextGrouper.group(sessions: sessions, websiteSummaries: [])

        XCTAssertEqual(blocks.count, 3)
        XCTAssertEqual(blocks[1].dominantCategory, .meetings)
        XCTAssertEqual(blocks[1].displayLabel, "Zoom Call")
    }

    func testShortCommunicationInterruptionIsAbsorbed() {
        let sessions = sequentialSessions(
            entries: [
                ("com.apple.TextEdit", "TextEdit", .writing, false, 60),
                ("com.tinyspeck.slackmacgap", "Slack", .communication, false, 3),
                ("com.apple.TextEdit", "TextEdit", .writing, false, 60),
            ]
        )

        let blocks = WorkContextGrouper.group(sessions: sessions, websiteSummaries: [])

        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks[0].dominantCategory, .writing)
        XCTAssertEqual(blocks[0].switchCount, 2)
    }

    func testLongSingleAppStreakStaysAsSingleBlock() {
        let sessions = alternatingSessions(
            entries: [
                ("com.apple.dt.Xcode", "Xcode", .development, false, 20),
                ("com.google.Chrome", "Chrome", .browsing, true, 2),
                ("com.apple.dt.Xcode", "Xcode", .development, false, 20),
                ("com.google.Chrome", "Chrome", .browsing, true, 2),
                ("com.apple.dt.Xcode", "Xcode", .development, false, 20),
                ("com.google.Chrome", "Chrome", .browsing, true, 2),
                ("com.apple.dt.Xcode", "Xcode", .development, false, 20),
                ("com.google.Chrome", "Chrome", .browsing, true, 2),
                ("com.apple.dt.Xcode", "Xcode", .development, false, 20),
            ]
        )

        let blocks = WorkContextGrouper.group(sessions: sessions, websiteSummaries: [])

        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks[0].dominantCategory, .development)
        XCTAssertEqual(blocks[0].displayLabel, "Xcode")
    }

    func testFragmentedAfternoonProducesSingleLowConfidenceBlock() {
        let sessions = sequentialSessions(
            entries: [
                ("com.apple.Preview", "Preview", .productivity, false, 10),
                ("com.apple.Safari", "Safari", .browsing, true, 10),
                ("com.tinyspeck.slackmacgap", "Slack", .communication, false, 10),
                ("com.apple.Music", "Music", .entertainment, false, 10),
                ("com.apple.mail", "Mail", .email, false, 10),
                ("com.figma.desktop", "Figma", .design, false, 10),
                ("com.apple.TextEdit", "TextEdit", .writing, false, 10),
                ("com.apple.dt.Xcode", "Xcode", .development, false, 10),
            ]
        )

        let blocks = WorkContextGrouper.group(sessions: sessions, websiteSummaries: [])

        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks[0].confidence, .low)
        XCTAssertEqual(blocks[0].displayLabel, "Mixed Work")
    }

    func testMeetingHeavyDayKeepsEachZoomCallSeparate() {
        let sessions = sequentialSessions(
            entries: [
                ("us.zoom.xos", "Zoom", .meetings, false, 45),
                ("com.tinyspeck.slackmacgap", "Slack", .communication, false, 15),
                ("com.apple.mail", "Mail", .email, false, 15),
                ("us.zoom.xos", "Zoom", .meetings, false, 45),
                ("com.tinyspeck.slackmacgap", "Slack", .communication, false, 15),
                ("com.apple.mail", "Mail", .email, false, 15),
                ("us.zoom.xos", "Zoom", .meetings, false, 45),
            ]
        )

        let blocks = WorkContextGrouper.group(sessions: sessions, websiteSummaries: [])
        let zoomBlocks = blocks.filter { $0.dominantCategory == .meetings && $0.displayLabel == "Zoom Call" }

        XCTAssertGreaterThanOrEqual(blocks.count, 3)
        XCTAssertEqual(zoomBlocks.count, 3)
    }

    func testSingleAppAllDayProducesOneBlock() {
        let sessions = sequentialSessions(
            entries: [
                ("com.microsoft.VSCode", "VS Code", .development, false, 360),
            ]
        )

        let blocks = WorkContextGrouper.group(sessions: sessions, websiteSummaries: [])

        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks[0].dominantCategory, .development)
        XCTAssertEqual(blocks[0].displayLabel, "VS Code")
    }

    private func sequentialSessions(
        entries: [(bundleID: String, appName: String, category: AppCategory, isBrowser: Bool, minutes: Int)]
    ) -> [AppSession] {
        var sessions: [AppSession] = []
        var currentOffset: TimeInterval = 9 * 3600

        for entry in entries {
            let duration = TimeInterval(entry.minutes * 60)
            sessions.append(
                makeSession(
                    bundleID: entry.bundleID,
                    appName: entry.appName,
                    startOffset: currentOffset,
                    endOffset: currentOffset + duration,
                    category: entry.category,
                    isBrowser: entry.isBrowser
                )
            )
            currentOffset += duration
        }

        return sessions
    }

    private func alternatingSessions(
        entries: [(bundleID: String, appName: String, category: AppCategory, isBrowser: Bool, minutes: Int)]
    ) -> [AppSession] {
        sequentialSessions(entries: entries)
    }

    private func makeSession(
        bundleID: String,
        appName: String,
        startOffset: TimeInterval,
        endOffset: TimeInterval,
        category: AppCategory,
        isBrowser: Bool = false
    ) -> AppSession {
        let startTime = day.addingTimeInterval(startOffset)
        let endTime = day.addingTimeInterval(endOffset)
        return AppSession(
            date: day,
            bundleID: bundleID,
            appName: appName,
            startTime: startTime,
            endTime: endTime,
            duration: endTime.timeIntervalSince(startTime),
            category: category,
            isBrowser: isBrowser
        )
    }
}
