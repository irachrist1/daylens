import Foundation
import Observation

@Observable
final class InsightsViewModel {
    var messages: [(role: String, content: String)] = []
    var inputText: String = ""
    var isProcessing: Bool = false
    var error: String?

    func askQuestion(aiService: AIService, date: Date) {
        let question = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }

        messages.append((role: "user", content: question))
        inputText = ""
        isProcessing = true
        error = nil

        Task { @MainActor in
            do {
                let appSummaries = (try? AppDatabase.shared.appUsageSummaries(for: date)) ?? []
                let websiteSummaries = (try? AppDatabase.shared.websiteUsageSummaries(for: date)) ?? []
                let browserSummaries = (try? AppDatabase.shared.browserUsageSummaries(for: date)) ?? []
                let dailySummary = try? AppDatabase.shared.dailySummary(for: date)

                let context = AIPromptBuilder.buildDayContext(
                    date: date,
                    appSummaries: appSummaries,
                    websiteSummaries: websiteSummaries,
                    browserSummaries: browserSummaries,
                    dailySummary: dailySummary
                )

                if aiService.isConfigured {
                    let answer = try await aiService.askQuestion(question, context: context)
                    messages.append((role: "assistant", content: answer))
                } else {
                    // Try local fallback
                    if let localAnswer = LocalAnalyzer.answerLocally(
                        question: question,
                        appSummaries: appSummaries,
                        websiteSummaries: websiteSummaries,
                        dailySummary: dailySummary
                    ) {
                        messages.append((role: "assistant", content: localAnswer))
                    } else {
                        messages.append((role: "assistant", content: "I need an API key to answer complex questions. Add your Anthropic API key in Settings, or try asking simpler questions like \"How much time on [app name]?\""))
                    }
                }
            } catch {
                self.error = error.localizedDescription
                messages.append((role: "assistant", content: "Sorry, I encountered an error: \(error.localizedDescription)"))
            }

            isProcessing = false
        }
    }
}
