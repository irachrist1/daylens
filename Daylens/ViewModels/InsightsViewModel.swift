import Foundation
import Observation

/// Message in the Insights conversation. Identifiable for stable ForEach rendering.
struct ChatMessage: Identifiable, Equatable {
    let id = UUID()
    let role: ChatRole
    let content: String

    enum ChatRole: String {
        case user
        case assistant
        case error
    }

    var isUser: Bool { role == .user }
}

@Observable
final class InsightsViewModel {
    var messages: [ChatMessage] = []
    var inputText: String = ""
    private(set) var isProcessing: Bool = false
    private(set) var lastError: String?

    func loadPersistedConversation() {
        guard messages.isEmpty else { return }
        Task { @MainActor in
            let turns = await Task.detached(priority: .userInitiated) {
                (try? AppDatabase.shared.loadRecentConversation()) ?? []
            }.value
            guard !turns.isEmpty, self.messages.isEmpty else { return }
            self.messages = turns.flatMap { turn in
                [ChatMessage(role: .user, content: turn.question),
                 ChatMessage(role: .assistant, content: turn.answer)]
            }
        }
    }

    func clearConversation() {
        guard !isProcessing else { return }
        messages.removeAll()
        inputText = ""
        lastError = nil
        Task.detached(priority: .utility) {
            try? AppDatabase.shared.clearSavedConversation()
        }
    }

    /// Ask a question grounded in today's real tracked data.
    /// Guards against duplicate sends — no-ops if already processing.
    func askQuestion(aiService: AIService, date: Date) {
        let question = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }
        guard !isProcessing else { return }

        messages.append(ChatMessage(role: .user, content: question))
        inputText = ""
        isProcessing = true
        lastError = nil

        Task { @MainActor in
            // Check API key first
            guard aiService.isConfigured else {
                appendError("Add your Anthropic API key in Settings to enable AI insights.")
                isProcessing = false
                return
            }

            let contextPayload: AIDayContextPayload
            let previousDays: [AIDayContextPayload]
            let profile: UserProfile?
            let memories: [UserMemory]
            do {
                (contextPayload, previousDays, profile, memories) = try await Task.detached(priority: .userInitiated) {
                    (
                        try AppDatabase.shared.aiContextPayload(for: date),
                        try AppDatabase.shared.recentAIPayloads(endingAt: date, limit: 7),
                        try AppDatabase.shared.fetchUserProfile(),
                        try AppDatabase.shared.fetchRecentMemories(limit: 20)
                    )
                }.value
            } catch {
                appendError("Couldn't load your activity data. Please try again.")
                isProcessing = false
                return
            }

            // No data check
            guard !contextPayload.appSummaries.isEmpty else {
                appendError("No activity tracked for that day yet. Use your Mac for a few minutes and check back.")
                isProcessing = false
                return
            }

            let context = AIPromptBuilder.buildContext(
                primaryDay: contextPayload,
                previousDays: previousDays
            )
            let systemPrompt = AIPromptBuilder.systemPrompt(profile: profile, memories: memories)

            do {
                let answer = try await aiService.askQuestion(question, context: context, systemPrompt: systemPrompt)
                messages.append(ChatMessage(role: .assistant, content: answer))
                let q = question, a = answer, d = date
                Task.detached(priority: .utility) {
                    try? AppDatabase.shared.saveConversationTurn(question: q, answer: a, for: d)
                }
                extractMemoryIfNeeded(from: question, answer: answer)
            } catch let error as AIError {
                appendError(error.localizedDescription)
            } catch is URLError {
                appendError("Couldn't reach the AI service. Check your internet connection and try again.")
            } catch {
                appendError("Something went wrong: \(error.localizedDescription)")
            }

            isProcessing = false
        }
    }

    private func appendError(_ message: String) {
        lastError = message
        messages.append(ChatMessage(role: .error, content: message))
    }

    private func extractMemoryIfNeeded(from question: String, answer: String) {
        Task.detached(priority: .utility) {
            let aiService = AIService()
            let response = try? await aiService.extractMemory(from: question, answer: answer)
            guard let response else { return }

            let trimmed = response.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            guard trimmed.uppercased() != "NONE" else { return }
            guard trimmed.count < 200 else { return }

            let memory = UserMemory(
                id: nil,
                fact: trimmed,
                source: "chat",
                createdAt: Date()
            )
            try? AppDatabase.shared.saveMemory(memory)
        }
    }
}
