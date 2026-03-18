import Foundation
import Anthropic

/// Manages conversational Q&A over user activity data.
/// Injects fresh data context with every query to ensure answers are grounded.
final class ConversationalAnalyst {
    private let aggregator: DailyAggregator
    private let insightRepo: InsightRepository
    private let client: AnthropicClient

    init(
        aggregator: DailyAggregator,
        insightRepo: InsightRepository,
        client: AnthropicClient
    ) {
        self.aggregator = aggregator
        self.insightRepo = insightRepo
        self.client = client
    }

    // MARK: - Streaming answer

    /// Returns an AsyncThrowingStream of text chunks for display in ChatView.
    /// Automatically builds a data context from the question's implied time scope.
    func streamAnswer(
        to question: String,
        priorMessages: [ConversationMessage]
    ) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    // Build data context based on question scope
                    let dateKey = self.inferDateKey(from: question)
                    let snapshot = try self.aggregator.buildAIDataSnapshot(for: dateKey)

                    let prompt = PromptTemplates.conversationalPrompt(
                        question: question,
                        dataSnapshot: snapshot,
                        conversationHistory: priorMessages
                    )

                    // Build Anthropic message history from prior assistant messages
                    let history: [Anthropic.Message] = priorMessages
                        .suffix(6)
                        .compactMap { msg in
                            switch msg.role {
                            case .user:
                                return Anthropic.Message(role: .user, content: .text(msg.content))
                            case .assistant:
                                return Anthropic.Message(role: .assistant, content: .text(msg.content))
                            case .system:
                                return nil
                            }
                        }

                    let stream = self.client.stream(
                        systemPrompt: PromptTemplates.systemPrompt,
                        userPrompt: prompt,
                        conversationMessages: history
                    )

                    for try await chunk in stream {
                        continuation.yield(chunk)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    // MARK: - Non-streaming answer (for programmatic use)

    func answer(question: String) async throws -> String {
        let dateKey = inferDateKey(from: question)
        let snapshot = try aggregator.buildAIDataSnapshot(for: dateKey)
        let prompt = PromptTemplates.conversationalPrompt(
            question: question,
            dataSnapshot: snapshot,
            conversationHistory: []
        )
        return try await client.complete(
            systemPrompt: PromptTemplates.systemPrompt,
            userPrompt: prompt
        )
    }

    // MARK: - Date scope inference

    /// Infers the most relevant dateKey from natural language question keywords.
    /// Defaults to today if no clear time reference is found.
    private func inferDateKey(from question: String) -> String {
        let q = question.lowercased()
        let calendar = Calendar.current
        let today = Date()

        if q.contains("yesterday") {
            let yesterday = calendar.date(byAdding: .day, value: -1, to: today) ?? today
            return AppSession.makeDateKey(from: yesterday.timeIntervalSince1970)
        }

        if q.contains("this week") || q.contains("week") {
            // For week-scoped questions, still use today's snapshot (weekly data is embedded)
            return AppSession.makeDateKey(from: today.timeIntervalSince1970)
        }

        // Default: today
        return AppSession.makeDateKey(from: today.timeIntervalSince1970)
    }
}
