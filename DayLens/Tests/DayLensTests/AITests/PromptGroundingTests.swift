import XCTest
@testable import DayLens

final class PromptGroundingTests: XCTestCase {

    // MARK: - System prompt safety

    func testSystemPromptContainsNoHallucinationRule() {
        let prompt = PromptTemplates.systemPrompt
        // Must contain explicit instruction against fabrication
        XCTAssertTrue(
            prompt.contains("Only reference") || prompt.contains("never invent") || prompt.contains("Never invent"),
            "System prompt must instruct against hallucination"
        )
    }

    func testSystemPromptContainsDataGroundingInstruction() {
        let prompt = PromptTemplates.systemPrompt
        XCTAssertTrue(
            prompt.contains("structured data"),
            "System prompt must reference structured data"
        )
    }

    // MARK: - Daily summary prompt

    func testDailySummaryPromptInjectsActualData() {
        let snapshot: [String: Any] = [
            "dateKey": "2024-01-15",
            "totalActiveSeconds": 3600.0,
            "focusScore": "0.75",
            "contextSwitchCount": 12,
            "topApps": [["name": "Xcode", "seconds": 3600]],
            "topSites": [["domain": "github.com", "seconds": 600]],
            "topBrowsers": []
        ]

        let prompt = PromptTemplates.dailySummaryPrompt(dataSnapshot: snapshot)

        // Prompt must contain the actual data values
        XCTAssertTrue(prompt.contains("2024-01-15"), "Prompt must include the date key")
        XCTAssertTrue(prompt.contains("Xcode"), "Prompt must include app names from data")
        XCTAssertTrue(prompt.contains("github.com"), "Prompt must include site domains from data")
        XCTAssertTrue(prompt.contains("0.75"), "Prompt must include focus score from data")
    }

    func testDailySummaryPromptContainsOnlyInstruction() {
        let snapshot: [String: Any] = [
            "dateKey": "2024-01-15",
            "totalActiveSeconds": 7200.0,
            "focusScore": "0.60",
            "contextSwitchCount": 5,
            "topApps": [],
            "topSites": [],
            "topBrowsers": []
        ]

        let prompt = PromptTemplates.dailySummaryPrompt(dataSnapshot: snapshot)
        XCTAssertTrue(prompt.contains("Only reference"),
                      "Daily summary prompt must include grounding instruction")
    }

    // MARK: - Conversational prompt

    func testConversationalPromptInjectsQuestion() {
        let question = "How much time did I spend on YouTube today?"
        let snapshot: [String: Any] = [
            "topSites": [["domain": "youtube.com", "seconds": 720]],
            "totalActiveSeconds": 3600,
            "dateKey": "2024-01-15",
            "focusScore": "0.5",
            "contextSwitchCount": 3,
            "topApps": [],
            "topBrowsers": []
        ]

        let prompt = PromptTemplates.conversationalPrompt(
            question: question,
            dataSnapshot: snapshot,
            conversationHistory: []
        )

        XCTAssertTrue(prompt.contains(question), "Prompt must include the user's exact question")
        XCTAssertTrue(prompt.contains("youtube.com"), "Prompt must include relevant site data")
        XCTAssertTrue(prompt.contains("720"), "Prompt must include the duration value")
    }

    func testConversationalPromptIncludesGroundingInstruction() {
        let question = "What did I do today?"
        let prompt = PromptTemplates.conversationalPrompt(
            question: question,
            dataSnapshot: ["totalActiveSeconds": 100, "dateKey": "2024-01-15",
                            "focusScore": "0.5", "contextSwitchCount": 1,
                            "topApps": [], "topSites": [], "topBrowsers": []],
            conversationHistory: []
        )

        XCTAssertTrue(
            prompt.contains("strictly on the data") || prompt.contains("strictly"),
            "Conversational prompt must include grounding instruction"
        )
    }

    // MARK: - Prompt does not contain hallucination hooks

    func testPromptsDoNotEncourageGuessing() {
        let badPhrases = ["if you think", "estimate", "assume", "you can guess", "feel free to infer"]
        let systemPrompt = PromptTemplates.systemPrompt

        for phrase in badPhrases {
            XCTAssertFalse(
                systemPrompt.lowercased().contains(phrase),
                "System prompt must not encourage guessing: '\(phrase)'"
            )
        }
    }

    // MARK: - Model names

    func testAllAIModelRawValuesAreCurrent() {
        XCTAssertEqual(AIModel.sonnet.rawValue, "claude-sonnet-4-6")
        XCTAssertEqual(AIModel.opus.rawValue, "claude-opus-4-6")
        XCTAssertEqual(AIModel.haiku.rawValue, "claude-haiku-4-5-20251001")
    }

    // MARK: - UserSettings defaults

    func testUserSettingsDefaults() {
        let settings = UserSettings()
        XCTAssertEqual(settings.selectedAIModel, .sonnet)
        XCTAssertEqual(settings.minimumSessionSeconds, 5)
        XCTAssertEqual(settings.mergeSwitchGapSeconds, 8)
        XCTAssertEqual(settings.idleGraceSeconds, 120)
        XCTAssertFalse(settings.isTrackingPaused)
        XCTAssertEqual(settings.privateBrowsingBehavior, .trackTimeOnly)
    }
}
