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

    private let store: ActivityStore

    // MARK: - Init

    init(store: ActivityStore) {
        self.store = store
    }

    // MARK: - Public Methods

    /// Send the current input as a user message and process the response.
    func sendMessage() {
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

                // Placeholder: wire to AI service when available.
                let assistantMessage = AIMessage(
                    conversationId: conv.id,
                    role: .assistant,
                    content: "AI response generation will be wired to the AI service."
                )
                try await store.insertMessage(assistantMessage)
                messages.append(assistantMessage)
            } catch {
                // Restore input on error
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
