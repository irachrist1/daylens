import Foundation
import Observation
import Security

/// Anthropic Claude API client for AI-powered insights.
@Observable
final class AIService {
    var isConfigured: Bool { apiKey != nil }
    var isProcessing: Bool = false

    private var apiKey: String? {
        KeychainHelper.read(
            service: Constants.keychainServiceName,
            account: Constants.anthropicAPIKeyAccount
        )
    }

    private let baseURL = Constants.anthropicAPIBaseURL
    private var model = Constants.defaultAIModel

    // MARK: - API Key Management

    func setAPIKey(_ key: String) {
        KeychainHelper.save(
            service: Constants.keychainServiceName,
            account: Constants.anthropicAPIKeyAccount,
            data: key
        )
    }

    func removeAPIKey() {
        KeychainHelper.delete(
            service: Constants.keychainServiceName,
            account: Constants.anthropicAPIKeyAccount
        )
    }

    func setModel(_ model: String) {
        self.model = model
    }

    // MARK: - Generate Summary

    func generateDailySummary(context: String) async throws -> String {
        let prompt = AIPromptBuilder.dailySummaryPrompt(activityContext: context)
        return try await sendMessage(prompt)
    }

    // MARK: - Chat

    func askQuestion(_ question: String, context: String) async throws -> String {
        let prompt = AIPromptBuilder.questionPrompt(question: question, activityContext: context)
        return try await sendMessage(prompt)
    }

    // MARK: - Streaming Chat

    func streamQuestion(_ question: String, context: String) -> AsyncThrowingStream<String, Error> {
        let prompt = AIPromptBuilder.questionPrompt(question: question, activityContext: context)
        return streamMessage(prompt)
    }

    // MARK: - API Communication

    private func sendMessage(_ userMessage: String) async throws -> String {
        guard let apiKey else {
            throw AIError.noAPIKey
        }

        isProcessing = true
        defer { isProcessing = false }

        let url = URL(string: "\(baseURL)/messages")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

        let body: [String: Any] = [
            "model": model,
            "max_tokens": 1024,
            "system": AIPromptBuilder.systemPrompt,
            "messages": [
                ["role": "user", "content": userMessage]
            ]
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AIError.networkError("Invalid response")
        }

        guard httpResponse.statusCode == 200 else {
            let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw AIError.apiError(statusCode: httpResponse.statusCode, message: errorBody)
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let content = json?["content"] as? [[String: Any]],
              let firstBlock = content.first,
              let text = firstBlock["text"] as? String else {
            throw AIError.parseError
        }

        return text
    }

    private func streamMessage(_ userMessage: String) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            Task {
                guard let apiKey = self.apiKey else {
                    continuation.finish(throwing: AIError.noAPIKey)
                    return
                }

                self.isProcessing = true

                let url = URL(string: "\(self.baseURL)/messages")!
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
                request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

                let body: [String: Any] = [
                    "model": self.model,
                    "max_tokens": 1024,
                    "stream": true,
                    "system": AIPromptBuilder.systemPrompt,
                    "messages": [
                        ["role": "user", "content": userMessage]
                    ]
                ]

                request.httpBody = try? JSONSerialization.data(withJSONObject: body)

                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)

                    guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                        continuation.finish(throwing: AIError.networkError("Bad response"))
                        self.isProcessing = false
                        return
                    }

                    for try await line in bytes.lines {
                        guard line.hasPrefix("data: ") else { continue }
                        let jsonStr = String(line.dropFirst(6))
                        guard jsonStr != "[DONE]",
                              let data = jsonStr.data(using: .utf8),
                              let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }

                        if let delta = event["delta"] as? [String: Any],
                           let text = delta["text"] as? String {
                            continuation.yield(text)
                        }
                    }

                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }

                self.isProcessing = false
            }
        }
    }
}

// MARK: - Errors

enum AIError: LocalizedError {
    case noAPIKey
    case networkError(String)
    case apiError(statusCode: Int, message: String)
    case parseError

    var errorDescription: String? {
        switch self {
        case .noAPIKey:
            return "No API key configured. Add your Anthropic API key in Settings."
        case .networkError(let msg):
            return "Network error: \(msg)"
        case .apiError(let code, let msg):
            return "API error (\(code)): \(msg)"
        case .parseError:
            return "Failed to parse AI response."
        }
    }
}

// MARK: - Keychain Helper

enum KeychainHelper {
    static func save(service: String, account: String, data: String) {
        let data = data.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        SecItemDelete(query as CFDictionary)

        var newItem = query
        newItem[kSecValueData as String] = data
        SecItemAdd(newItem as CFDictionary, nil)
    }

    static func read(service: String, account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(service: String, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
