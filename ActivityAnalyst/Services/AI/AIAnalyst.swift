import Foundation
#if canImport(AnthropicSwiftSDK)
import AnthropicSwiftSDK
#endif

/// Core AI analysis engine using the Anthropic Swift SDK (AnthropicSwiftSDK).
/// Provides daily summaries, trend analysis, and conversational Q&A.
///
/// Uses Claude Sonnet 4.6 by default, with options for Opus 4.6 and Haiku 4.5.
/// All prompts are grounded in real activity data with evidence citations.
///
/// SDK Reference: https://github.com/fumito-ito/AnthropicSwiftSDK
/// Claude Code / Agent SDK is available for backend tooling in TypeScript/Python
/// and can be used for CI/CD, batch analysis, or server-side agent workflows.
actor AIAnalyst {
    private let apiKey: String
    private var currentModel: AIModel
    private var conversationHistories: [UUID: [(role: String, content: String)]] = [:]

    #if canImport(AnthropicSwiftSDK)
    private let anthropic: Anthropic
    #endif

    init(
        apiKey: String,
        defaultModel: AIModel = .sonnet
    ) {
        self.apiKey = apiKey
        self.currentModel = defaultModel

        #if canImport(AnthropicSwiftSDK)
        self.anthropic = Anthropic(apiKey: apiKey)
        #endif
    }

    // MARK: - Daily Summary

    func generateDailySummary(
        date: Date,
        summary: DailySummary,
        topApps: [RankedItem],
        topWebsites: [RankedItem]
    ) async throws -> String {
        let prompt = PromptBuilder.dailySummaryPrompt(
            date: date,
            summary: summary,
            topApps: topApps,
            topWebsites: topWebsites,
            sessionCount: summary.sessionCount,
            switchCount: summary.switchCount
        )

        return try await sendMessage(prompt, maxTokens: 500)
    }

    // MARK: - Question Answering

    func answerQuestion(
        _ question: String,
        context: ActivityContext,
        conversationId: UUID? = nil
    ) async throws -> (answer: String, evidence: [EvidenceReference]) {
        let prompt = PromptBuilder.questionPrompt(
            question: question,
            contextData: context
        )

        var messages: [(role: String, content: String)] = []
        if let convId = conversationId, let history = conversationHistories[convId] {
            messages = history
        }
        messages.append(("user", prompt))

        let answer = try await sendMessages(messages, maxTokens: 800)

        if let convId = conversationId {
            conversationHistories[convId, default: []].append(("user", prompt))
            conversationHistories[convId, default: []].append(("assistant", answer))
        }

        let evidence = extractEvidence(from: context, question: question)

        return (answer: answer, evidence: evidence)
    }

    // MARK: - Trend Analysis

    func analyzeTrends(summaries: [DailySummary]) async throws -> [Insight] {
        guard !summaries.isEmpty else { return [] }

        let prompt = PromptBuilder.trendPrompt(summaries: summaries)

        let response = try await sendMessage(prompt, maxTokens: 600)

        let insight = Insight(
            dailySummaryId: summaries.first!.id,
            type: .trend,
            title: "Weekly Trends",
            body: response
        )

        return [insight]
    }

    // MARK: - Model Management

    func setModel(_ model: AIModel) {
        currentModel = model
    }

    func clearConversation(_ conversationId: UUID) {
        conversationHistories.removeValue(forKey: conversationId)
    }

    // MARK: - Anthropic SDK Integration

    /// Sends a single user message via the Anthropic SDK.
    private func sendMessage(_ content: String, maxTokens: Int) async throws -> String {
        return try await sendMessages([("user", content)], maxTokens: maxTokens)
    }

    /// Sends a conversation of messages via the Anthropic SDK.
    private func sendMessages(
        _ messages: [(role: String, content: String)],
        maxTokens: Int
    ) async throws -> String {
        #if canImport(AnthropicSwiftSDK)
        let sdkMessages = messages.map { role, content in
            Message(
                role: role == "user" ? .user : .assistant,
                content: [.text(content)]
            )
        }

        let response = try await anthropic.messages.createMessage(
            sdkMessages,
            model: anthropicModel(currentModel),
            system: [.text(PromptBuilder.systemPrompt, nil)],
            maxTokens: maxTokens
        )

        guard let textBlock = response.content.first else {
            throw AIAnalystError.parseError
        }

        switch textBlock {
        case .text(let text, _):
            return text
        default:
            throw AIAnalystError.parseError
        }
        #else
        return try await sendMessagesHTTP(messages, maxTokens: maxTokens)
        #endif
    }

    #if canImport(AnthropicSwiftSDK)
    private func anthropicModel(_ model: AIModel) -> AnthropicSwiftSDK.Model {
        return .custom(model.rawValue)
    }
    #endif

    /// HTTP fallback for environments where AnthropicSwiftSDK is not available.
    private func sendMessagesHTTP(
        _ messages: [(role: String, content: String)],
        maxTokens: Int
    ) async throws -> String {
        let url = URL(string: "https://api.anthropic.com/v1/messages")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

        let messagesPayload = messages.map { role, content in
            ["role": role, "content": content]
        }

        let body: [String: Any] = [
            "model": currentModel.rawValue,
            "max_tokens": maxTokens,
            "system": PromptBuilder.systemPrompt,
            "messages": messagesPayload,
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AIAnalystError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw AIAnalystError.apiError(statusCode: httpResponse.statusCode, message: errorBody)
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let content = json["content"] as? [[String: Any]],
              let firstBlock = content.first,
              let text = firstBlock["text"] as? String else {
            throw AIAnalystError.parseError
        }

        return text
    }

    // MARK: - Evidence Extraction

    private func extractEvidence(
        from context: ActivityContext,
        question: String
    ) -> [EvidenceReference] {
        var evidence: [EvidenceReference] = []
        let lowered = question.lowercased()

        for (name, duration) in context.appDurations.prefix(5) {
            if lowered.contains(name.lowercased()) {
                evidence.append(EvidenceReference(
                    appName: name,
                    duration: duration,
                    description: "\(name): \(DurationFormatter.format(duration)) total"
                ))
            }
        }

        for (domain, duration) in context.websiteDurations.prefix(5) {
            if lowered.contains(domain.lowercased()) {
                evidence.append(EvidenceReference(
                    domain: domain,
                    duration: duration,
                    description: "\(domain): \(DurationFormatter.format(duration)) total"
                ))
            }
        }

        if evidence.isEmpty {
            evidence.append(EvidenceReference(
                description: "\(context.dateRange) — \(DurationFormatter.format(context.totalActiveTime)) active time across \(context.sessionCount) sessions"
            ))
        }

        return evidence
    }
}

// MARK: - Errors

enum AIAnalystError: Error, LocalizedError {
    case invalidResponse
    case apiError(statusCode: Int, message: String)
    case parseError
    case noApiKey

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Received an invalid response from the AI service."
        case .apiError(let code, let message):
            return "AI service error (\(code)): \(message)"
        case .parseError:
            return "Failed to parse the AI response."
        case .noApiKey:
            return "No API key configured. Add your Anthropic API key in Settings."
        }
    }
}
