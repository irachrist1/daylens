import Foundation
import SwiftUI

/// ViewModel for the AI chat: conversations, messages, and input.
@MainActor
final class AIConversationViewModel: ObservableObject {
    // MARK: - Published State

    @Published private(set) var messages: [AIMessage] = []
    @Published var currentConversation: AIConversation?
    @Published private(set) var isProcessing = false
    @Published var inputText: String = ""

    // MARK: - Dependencies

    private let store: ActivityStore?

    // MARK: - Init

    convenience init() {
        self.init(store: ServiceContainer.shared.store)
    }

    init(store: ActivityStore?) {
        self.store = store
    }

    // MARK: - Public Methods

    /// Send the current input as a user message and process the response.
    func sendMessage() {
        guard let store = store else { return }

        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        inputText = ""

        Task {
            isProcessing = true
            defer { isProcessing = false }

            var conversation = currentConversation

            if conversation == nil {
                do {
                    conversation = try await store.createConversation(title: String(text.prefix(50)))
                    currentConversation = conversation
                } catch {
                    return
                }
            }

            guard let conv = conversation else { return }

            let userMessage = AIMessage(
                conversationId: conv.id,
                role: .user,
                content: text
            )

            do {
                try await store.insertMessage(userMessage)
                messages.append(userMessage)

                let assistantMessage: AIMessage
                if let conversationManager = ServiceContainer.shared.conversationManager {
                    let (response, evidence) = try await conversationManager.processMessage(text, conversationId: conv.id)
                    assistantMessage = AIMessage(
                        conversationId: conv.id,
                        role: .assistant,
                        content: response,
                        evidence: evidence
                    )
                } else {
                    assistantMessage = AIMessage(
                        conversationId: conv.id,
                        role: .assistant,
                        content: "AI is not configured. Add your Anthropic API key in Settings to enable AI features."
                    )
                }

                try await store.insertMessage(assistantMessage)
                messages.append(assistantMessage)
            } catch {
                inputText = text
            }
        }
    }

    /// Start a new conversation.
    func startNewConversation() {
        currentConversation = nil
        messages = []
        inputText = ""
    }

    /// Load an existing conversation and its messages.
    func loadConversation(_ conversation: AIConversation?) {
        guard let store = store else {
            currentConversation = conversation
            messages = []
            return
        }

        currentConversation = conversation

        guard let conv = conversation else {
            messages = []
            return
        }

        Task {
            do {
                messages = try await store.fetchMessages(for: conv.id)
            } catch {
                messages = []
            }
        }
    }
}
