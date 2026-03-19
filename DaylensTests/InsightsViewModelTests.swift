import XCTest

#if canImport(Daylens)
@testable import Daylens
#else
@testable import DaylensCore
#endif

final class InsightsViewModelTests: XCTestCase {

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: Constants.DefaultsKey.anthropicAPIKey)
        try? KeychainService(service: "com.daylens.app").removeString(for: Constants.DefaultsKey.anthropicAPIKey)
        super.tearDown()
    }

    // MARK: - ChatMessage

    func testChatMessageRoles() {
        let userMsg = ChatMessage(role: .user, content: "Hello")
        XCTAssertTrue(userMsg.isUser)

        let assistantMsg = ChatMessage(role: .assistant, content: "Hi")
        XCTAssertFalse(assistantMsg.isUser)

        let errorMsg = ChatMessage(role: .error, content: "Oops")
        XCTAssertFalse(errorMsg.isUser)
        XCTAssertEqual(errorMsg.role, .error)
    }

    func testChatMessageIdentity() {
        let msg1 = ChatMessage(role: .user, content: "Hello")
        let msg2 = ChatMessage(role: .user, content: "Hello")
        // Each message should have a unique ID
        XCTAssertNotEqual(msg1.id, msg2.id)
    }

    // MARK: - Draft Retention

    func testDraftRetention() {
        let vm = InsightsViewModel()
        vm.inputText = "My draft question"
        XCTAssertEqual(vm.inputText, "My draft question")

        // Simulate what happens when state is preserved (same instance)
        XCTAssertEqual(vm.inputText, "My draft question")
    }

    func testInputClearedAfterSend() {
        let vm = InsightsViewModel()
        let service = AIService()
        vm.inputText = "Test question"
        vm.askQuestion(aiService: service, date: Date())
        // Input should be cleared immediately after send
        XCTAssertEqual(vm.inputText, "")
    }

    // MARK: - Empty Input Guard

    func testEmptyInputDoesNotSend() {
        let vm = InsightsViewModel()
        let service = AIService()
        vm.inputText = ""
        vm.askQuestion(aiService: service, date: Date())
        XCTAssertTrue(vm.messages.isEmpty)
        XCTAssertFalse(vm.isProcessing)
    }

    func testWhitespaceOnlyInputDoesNotSend() {
        let vm = InsightsViewModel()
        let service = AIService()
        vm.inputText = "   \n  "
        vm.askQuestion(aiService: service, date: Date())
        XCTAssertTrue(vm.messages.isEmpty)
        XCTAssertFalse(vm.isProcessing)
    }

    // MARK: - Duplicate Send Prevention

    func testDuplicateSendPrevention() {
        let vm = InsightsViewModel()
        let service = AIService()

        // First send — will set isProcessing = true and add user message
        vm.inputText = "First question"
        vm.askQuestion(aiService: service, date: Date())
        XCTAssertEqual(vm.messages.count, 1) // user message added
        XCTAssertTrue(vm.isProcessing)

        // Second send while processing — should be rejected
        vm.inputText = "Second question"
        let messageCountBefore = vm.messages.count
        vm.askQuestion(aiService: service, date: Date())
        XCTAssertEqual(vm.messages.count, messageCountBefore) // no new message
        // inputText should NOT have been cleared since send was rejected
        XCTAssertEqual(vm.inputText, "Second question")
    }

    // MARK: - No API Key Handling

    func testNoAPIKeyAddsErrorMessage() {
        let vm = InsightsViewModel()
        // Ensure no key is configured
        UserDefaults.standard.removeObject(forKey: Constants.DefaultsKey.anthropicAPIKey)
        try? KeychainService(service: "com.daylens.app").removeString(for: Constants.DefaultsKey.anthropicAPIKey)
        let service = AIService()

        vm.inputText = "My question"
        vm.askQuestion(aiService: service, date: Date())

        // User message is added synchronously
        XCTAssertEqual(vm.messages.count, 1)
        XCTAssertEqual(vm.messages[0].role, .user)

        // The error response is added asynchronously, so we need to wait
        let expectation = expectation(description: "Error message appended")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            XCTAssertEqual(vm.messages.count, 2)
            XCTAssertEqual(vm.messages[1].role, .error)
            XCTAssertTrue(vm.messages[1].content.contains("API key"))
            XCTAssertFalse(vm.isProcessing)
            XCTAssertNotNil(vm.lastError)
            expectation.fulfill()
        }
        waitForExpectations(timeout: 2)
    }

    // MARK: - State Ownership

    func testSessionScopedStateOnSameInstance() {
        let vm = InsightsViewModel()
        // Simulate messages accumulated during a session
        vm.messages.append(ChatMessage(role: .user, content: "Q1"))
        vm.messages.append(ChatMessage(role: .assistant, content: "A1"))
        vm.inputText = "Draft"

        // The same instance retains everything
        XCTAssertEqual(vm.messages.count, 2)
        XCTAssertEqual(vm.inputText, "Draft")
    }

    func testNewInstanceStartsFresh() {
        let vm1 = InsightsViewModel()
        vm1.messages.append(ChatMessage(role: .user, content: "Q1"))
        vm1.inputText = "Draft"

        // A new instance (simulating app relaunch) starts clean
        let vm2 = InsightsViewModel()
        XCTAssertTrue(vm2.messages.isEmpty)
        XCTAssertEqual(vm2.inputText, "")
        XCTAssertFalse(vm2.isProcessing)
        XCTAssertNil(vm2.lastError)
    }

    // MARK: - Error State

    func testLastErrorTracking() {
        let vm = InsightsViewModel()
        XCTAssertNil(vm.lastError)

        // lastError is set when an error message is appended
        // We can't easily test the full flow without mocking, but we can verify initial state
        XCTAssertNil(vm.lastError)
        XCTAssertFalse(vm.isProcessing)
    }
}
