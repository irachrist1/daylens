import Foundation
import Anthropic

/// Thin wrapper around the Anthropic Swift SDK.
/// Manages model selection and provides streaming + non-streaming message APIs.
final class AnthropicClient {
    private let settings: UserSettings

    private var apiKey: String {
        settings.anthropicApiKey
    }

    var selectedModel: String {
        settings.selectedAIModel.rawValue
    }

    init(settings: UserSettings) {
        self.settings = settings
    }

    // MARK: - Non-streaming completion

    func complete(
        systemPrompt: String,
        userPrompt: String,
        maxTokens: Int = 1024
    ) async throws -> String {
        guard !apiKey.isEmpty else {
            throw AnthropicClientError.missingAPIKey
        }

        let client = Client(apiKey: apiKey)

        let message = try await client.messages.create(
            model: selectedModel,
            maxTokens: maxTokens,
            system: systemPrompt,
            messages: [
                .init(role: .user, content: .text(userPrompt))
            ]
        )

        return message.content.compactMap { block -> String? in
            if case .text(let t) = block { return t }
            return nil
        }.joined()
    }

    // MARK: - Streaming completion

    /// Returns an AsyncThrowingStream of text chunks.
    func stream(
        systemPrompt: String,
        userPrompt: String,
        conversationMessages: [Anthropic.Message] = [],
        maxTokens: Int = 1024
    ) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            Task {
                guard !self.apiKey.isEmpty else {
                    continuation.finish(throwing: AnthropicClientError.missingAPIKey)
                    return
                }

                let client = Client(apiKey: self.apiKey)

                do {
                    var allMessages = conversationMessages
                    allMessages.append(.init(role: .user, content: .text(userPrompt)))

                    let stream = try await client.messages.stream(
                        model: self.selectedModel,
                        maxTokens: maxTokens,
                        system: systemPrompt,
                        messages: allMessages
                    )

                    for try await event in stream {
                        if case .contentBlockDelta(let delta) = event,
                           case .textDelta(let textDelta) = delta.delta {
                            continuation.yield(textDelta.text)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }
}

// MARK: - Errors

enum AnthropicClientError: LocalizedError {
    case missingAPIKey
    case emptyResponse

    var errorDescription: String? {
        switch self {
        case .missingAPIKey:
            return "No Anthropic API key configured. Please add your key in Settings."
        case .emptyResponse:
            return "The AI returned an empty response."
        }
    }
}
