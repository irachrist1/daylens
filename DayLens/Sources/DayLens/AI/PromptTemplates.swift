import Foundation

/// Grounded prompt construction for DayLens AI analyst.
/// All prompts are designed to prevent hallucination by injecting
/// only structured, real data and explicitly instructing against fabrication.
enum PromptTemplates {

    // MARK: - System prompt

    static let systemPrompt = """
    You are a calm, thoughtful personal activity analyst for DayLens.
    Your job is to help the user understand how they spend time on their computer.

    Critical rules you must always follow:
    1. Only reference apps, websites, and durations that appear in the structured data provided.
    2. Never invent or estimate time that is not explicitly present in the data.
    3. If the data is insufficient to answer a question, say so clearly and honestly.
    4. Avoid generic productivity clichés ("You had a productive day!", "Great job!").
    5. Be specific, grounded, and concise. Prefer one insightful sentence over three vague ones.
    6. Never use bullet points in daily summaries — write in natural prose.
    7. When citing a duration, use the exact value from the data.
    """

    // MARK: - Daily summary

    static func dailySummaryPrompt(dataSnapshot: [String: Any]) -> String {
        let json = (try? JSONSerialization.data(withJSONObject: dataSnapshot, options: .prettyPrinted))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"

        return """
        Here is today's complete activity data for the user:

        \(json)

        Generate a calm, concise narrative summary (3–5 sentences) of how this day went.
        Include:
        - How much total time was spent actively working
        - The most significant apps or websites
        - Whether the day appeared focused or fragmented (reference the focusScore and contextSwitchCount)
        - Any notable patterns worth mentioning

        Only reference what is present in the data above.
        Write in second person ("You spent…").
        Do not use headers or bullet points.
        """
    }

    // MARK: - Conversational Q&A

    static func conversationalPrompt(
        question: String,
        dataSnapshot: [String: Any],
        conversationHistory: [ConversationMessage]
    ) -> String {
        let json = (try? JSONSerialization.data(withJSONObject: dataSnapshot, options: .prettyPrinted))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"

        let historyText = conversationHistory
            .suffix(6)  // Last 3 exchanges for context
            .map { "\($0.role.rawValue.capitalized): \($0.content)" }
            .joined(separator: "\n\n")

        return """
        The user is asking about their computer activity. Here is the relevant data:

        \(json)

        \(historyText.isEmpty ? "" : "Prior conversation:\n\(historyText)\n")

        User question: \(question)

        Answer based strictly on the data provided above. If the answer requires a specific \
        number that is in the data, state it exactly. If the data doesn't contain enough \
        information to answer, say so directly. Be concise — 1 to 3 sentences is usually enough.
        """
    }

    // MARK: - Weekly trend summary

    static func weeklyTrendPrompt(trends: [[String: Any]]) -> String {
        let json = (try? JSONSerialization.data(withJSONObject: trends, options: .prettyPrinted))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"

        return """
        Here is the user's activity data for the past 7 days:

        \(json)

        Write 2–3 sentences identifying the most notable pattern across this week.
        Only reference what is in the data. Be specific about dates or days when relevant.
        Do not use bullet points.
        """
    }
}
