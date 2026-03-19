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

    func clearConversation() {
        guard !isProcessing else { return }
        messages.removeAll()
        inputText = ""
        lastError = nil
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

            let contextPayload: (
                appSummaries: [AppUsageSummary],
                websiteSummaries: [WebsiteUsageSummary],
                browserSummaries: [BrowserUsageSummary],
                dailySummary: DailySummary?
            )
            do {
                contextPayload = try await Task.detached(priority: .userInitiated) {
                    (
                        appSummaries: try AppDatabase.shared.appUsageSummaries(for: date),
                        websiteSummaries: try AppDatabase.shared.websiteUsageSummaries(for: date),
                        browserSummaries: try AppDatabase.shared.browserUsageSummaries(for: date),
                        dailySummary: try AppDatabase.shared.dailySummary(for: date)
                    )
                }.value
            } catch {
                appendError("Couldn't load your activity data. Please try again.")
                isProcessing = false
                return
            }

            let appSummaries = contextPayload.appSummaries
            let websiteSummaries = contextPayload.websiteSummaries
            let browserSummaries = contextPayload.browserSummaries
            let dailySummary = contextPayload.dailySummary

            // No data check
            guard !appSummaries.isEmpty else {
                appendError("No activity tracked yet today. Use your Mac for a few minutes and check back.")
                isProcessing = false
                return
            }

            let context = AIPromptBuilder.buildDayContext(
                date: date,
                appSummaries: appSummaries,
                websiteSummaries: websiteSummaries,
                browserSummaries: browserSummaries,
                dailySummary: dailySummary
            )

            do {
                let answer = try await aiService.askQuestion(question, context: context)
                messages.append(ChatMessage(role: .assistant, content: answer))
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
}
