import Foundation
import Observation

/// Anthropic Claude API client for AI-powered insights.
@Observable
final class AIService {
    private(set) var isConfigured: Bool
    private(set) var model: String
    var isProcessing: Bool = false
    private let session: URLSession

    private static let keychain = KeychainService(service: "com.daylens.app")

    private var apiKey: String? {
        let key = Self.keychain.string(for: Constants.DefaultsKey.anthropicAPIKey)
        return (key?.isEmpty == false) ? key : nil
    }

    init(session: URLSession = AIService.makeSession()) {
        self.session = session
        Self.migrateUserDefaultsToKeychainIfNeeded()

        let storedModel = UserDefaults.standard.string(forKey: Constants.DefaultsKey.anthropicModel)
        if let storedModel,
           Constants.anthropicModels.contains(where: { $0.id == storedModel }) {
            model = storedModel
        } else {
            model = Constants.defaultAIModel
        }
        isConfigured = Self.keychain.string(for: Constants.DefaultsKey.anthropicAPIKey)?.isEmpty == false
    }

    private let baseURL = Constants.anthropicAPIBaseURL

    // MARK: - API Key Management

    @discardableResult
    func setAPIKey(_ key: String) -> Bool {
        do {
            try Self.keychain.setString(key, for: Constants.DefaultsKey.anthropicAPIKey)
            isConfigured = true
            return true
        } catch {
            return false
        }
    }

    @discardableResult
    func removeAPIKey() -> Bool {
        do {
            try Self.keychain.removeString(for: Constants.DefaultsKey.anthropicAPIKey)
            isConfigured = false
            return true
        } catch {
            return false
        }
    }

    func setModel(_ model: String) {
        guard Constants.anthropicModels.contains(where: { $0.id == model }) else { return }
        UserDefaults.standard.set(model, forKey: Constants.DefaultsKey.anthropicModel)
        self.model = model
    }

    func currentAPIKey() -> String? {
        apiKey
    }

    /// One-time migration: consolidates any key stored in previous locations into
    /// the current Keychain slot. Checks three legacy locations in priority order:
    ///   1. UserDefaults (intermediate release that stored key in plaintext)
    ///   2. Original Keychain service "com.daylens.api-keys" / account "anthropic-api-key"
    /// Runs only when the key is absent from the current Keychain slot.
    private static func migrateUserDefaultsToKeychainIfNeeded() {
        guard keychain.string(for: Constants.DefaultsKey.anthropicAPIKey) == nil else {
            return  // Already in current Keychain slot, nothing to do.
        }
        // Check UserDefaults (previous intermediate storage location).
        if let legacyKey = UserDefaults.standard.string(forKey: Constants.DefaultsKey.anthropicAPIKey),
           !legacyKey.isEmpty {
            try? keychain.setString(legacyKey, for: Constants.DefaultsKey.anthropicAPIKey)
            UserDefaults.standard.removeObject(forKey: Constants.DefaultsKey.anthropicAPIKey)
            return
        }
        // Check original Keychain service/account used before the intermediate release.
        let originalKeychain = KeychainService(service: "com.daylens.api-keys")
        if let legacyKey = originalKeychain.string(for: "anthropic-api-key"), !legacyKey.isEmpty {
            try? keychain.setString(legacyKey, for: Constants.DefaultsKey.anthropicAPIKey)
            try? originalKeychain.removeString(for: "anthropic-api-key")
        }
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

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AIError.networkError("Invalid response")
        }

        guard httpResponse.statusCode == 200 else {
            throw AIError.apiError(
                statusCode: httpResponse.statusCode,
                message: sanitizedErrorMessage(from: data)
            )
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
                    let (bytes, response) = try await self.session.bytes(for: request)

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


    private func sanitizedErrorMessage(from data: Data) -> String {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let error = json["error"] as? [String: Any],
               let message = error["message"] as? String {
                return Self.truncatedErrorMessage(message)
            }

            if let message = json["message"] as? String {
                return Self.truncatedErrorMessage(message)
            }
        }

        return "Request failed."
    }

    private static func truncatedErrorMessage(_ message: String) -> String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Request failed." }
        return String(trimmed.prefix(160))
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        configuration.waitsForConnectivity = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        return URLSession(configuration: configuration)
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
