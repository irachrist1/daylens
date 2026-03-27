import Foundation

/// A semantically coherent period of work, derived by grouping consecutive AppSessions.
struct WorkContextBlock: Identifiable {
    let id: UUID

    // Time bounds
    let startTime: Date
    let endTime: Date
    var duration: TimeInterval { endTime.timeIntervalSince(startTime) }

    // Classification
    let dominantCategory: AppCategory
    let categoryDistribution: [AppCategory: TimeInterval]

    // Label (two layers: rule-based fallback, AI-enhanced when available)
    let ruleBasedLabel: String
    var aiLabel: String?

    /// The label to display in the UI: aiLabel if available, else ruleBasedLabel
    var displayLabel: String { aiLabel ?? ruleBasedLabel }

    // Composition
    let sessions: [AppSession]
    let topApps: [AppUsageSummary]
    let websites: [WebsiteUsageSummary]

    // Metadata
    let switchCount: Int
    let confidence: BlockConfidence
    let isLive: Bool
}

enum BlockConfidence: Equatable {
    case high
    case medium
    case low
}

extension WorkContextBlock {
    func with(
        websites: [WebsiteUsageSummary]? = nil,
        isLive: Bool? = nil,
        aiLabel: String?? = nil,
        ruleBasedLabel: String? = nil,
        confidence: BlockConfidence? = nil
    ) -> WorkContextBlock {
        WorkContextBlock(
            id: id,
            startTime: startTime,
            endTime: endTime,
            dominantCategory: dominantCategory,
            categoryDistribution: categoryDistribution,
            ruleBasedLabel: ruleBasedLabel ?? self.ruleBasedLabel,
            aiLabel: aiLabel ?? self.aiLabel,
            sessions: sessions,
            topApps: topApps,
            websites: websites ?? self.websites,
            switchCount: switchCount,
            confidence: confidence ?? self.confidence,
            isLive: isLive ?? self.isLive
        )
    }
}
