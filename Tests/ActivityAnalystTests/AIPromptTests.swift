import XCTest
@testable import ActivityAnalystCore

final class AIPromptTests: XCTestCase {

    // MARK: - System Prompt Safety

    func testSystemPromptContainsGroundingConstraints() {
        let prompt = PromptBuilder.systemPrompt
        XCTAssertTrue(prompt.contains("Only make claims supported by the activity data"))
        XCTAssertTrue(prompt.contains("Never fabricate"))
        XCTAssertTrue(prompt.contains("data is insufficient"))
    }

    func testSystemPromptRequiresCitations() {
        let prompt = PromptBuilder.systemPrompt
        XCTAssertTrue(prompt.contains("exact numbers"))
    }

    func testSystemPromptDiscouragesGenericAdvice() {
        let prompt = PromptBuilder.systemPrompt
        XCTAssertTrue(prompt.contains("generic productivity"))
    }

    // MARK: - Daily Summary Prompt

    func testDailySummaryPromptIncludesData() {
        let summary = DailySummary(
            date: Date(),
            totalActiveTime: 7200,
            focusScore: 0.65,
            fragmentationScore: 0.3,
            sessionCount: 42,
            switchCount: 38
        )

        let topApps = [
            RankedItem(id: UUID(), name: "Xcode", duration: 3600, category: .development, percentage: 0.5),
            RankedItem(id: UUID(), name: "Chrome", duration: 1800, category: .reference, percentage: 0.25),
        ]

        let prompt = PromptBuilder.dailySummaryPrompt(
            date: Date(),
            summary: summary,
            topApps: topApps,
            topWebsites: [],
            sessionCount: 42,
            switchCount: 38
        )

        XCTAssertTrue(prompt.contains("2 hours"))
        XCTAssertTrue(prompt.contains("42"))
        XCTAssertTrue(prompt.contains("38"))
        XCTAssertTrue(prompt.contains("65%"))
        XCTAssertTrue(prompt.contains("Xcode"))
        XCTAssertTrue(prompt.contains("Chrome"))
    }

    func testDailySummaryPromptIncludesWebsites() {
        let summary = DailySummary(date: Date(), totalActiveTime: 3600)

        let topWebsites = [
            RankedItem(id: UUID(), name: "github.com", duration: 1200, category: .development, percentage: 0.33),
        ]

        let prompt = PromptBuilder.dailySummaryPrompt(
            date: Date(),
            summary: summary,
            topApps: [],
            topWebsites: topWebsites,
            sessionCount: 10,
            switchCount: 8
        )

        XCTAssertTrue(prompt.contains("github.com"))
        XCTAssertTrue(prompt.contains("TOP WEBSITES"))
    }

    // MARK: - Question Prompt

    func testQuestionPromptIncludesUserQuestion() {
        let context = ActivityContext(
            dateRange: "Mar 18 – Mar 18",
            totalActiveTime: 3600,
            appDurations: [("Xcode", 1800)],
            websiteDurations: [("youtube.com", 600)],
            browserDurations: [("Chrome", 1200)],
            focusScore: 0.5,
            sessionCount: 10,
            switchCount: 8
        )

        let prompt = PromptBuilder.questionPrompt(
            question: "How much time did I spend on YouTube today?",
            contextData: context
        )

        XCTAssertTrue(prompt.contains("How much time did I spend on YouTube today?"))
        XCTAssertTrue(prompt.contains("youtube.com"))
        XCTAssertTrue(prompt.contains("10m"))
        XCTAssertTrue(prompt.contains("ONLY on the data above"))
    }

    func testQuestionPromptDoesNotIncludeRawURLs() {
        let context = ActivityContext(
            dateRange: "Mar 18",
            totalActiveTime: 0,
            appDurations: [],
            websiteDurations: [],
            browserDurations: [],
            focusScore: 0,
            sessionCount: 0,
            switchCount: 0
        )

        let prompt = PromptBuilder.questionPrompt(
            question: "test question",
            contextData: context
        )

        XCTAssertFalse(prompt.contains("https://"))
        XCTAssertFalse(prompt.contains("?token="))
    }

    // MARK: - Trend Prompt

    func testTrendPromptIncludesMultipleDays() {
        let summaries = (0..<5).map { dayOffset -> DailySummary in
            let date = Calendar.current.date(byAdding: .day, value: -dayOffset, to: Date())!
            return DailySummary(
                date: date,
                totalActiveTime: TimeInterval(3600 + dayOffset * 600),
                topApps: [RankedItem(id: UUID(), name: "Xcode", duration: 1800)],
                focusScore: Double(50 + dayOffset * 5) / 100.0,
                sessionCount: 10 + dayOffset * 2
            )
        }

        let prompt = PromptBuilder.trendPrompt(summaries: summaries)

        XCTAssertTrue(prompt.contains("Xcode"))
        XCTAssertTrue(prompt.contains("patterns"))
        XCTAssertTrue(prompt.contains("sessions"))
    }

    // MARK: - AI Model Configuration

    func testDefaultModelIsSonnet() {
        let model = AIModel.sonnet
        XCTAssertEqual(model.rawValue, "claude-sonnet-4-20250514")
    }

    func testModelDisplayNames() {
        XCTAssertEqual(AIModel.sonnet.displayName, "Claude Sonnet 4.6")
        XCTAssertEqual(AIModel.opus.displayName, "Claude Opus 4.6")
        XCTAssertEqual(AIModel.haiku.displayName, "Claude Haiku 4.5")
    }
}
