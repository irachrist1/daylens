import Foundation

/// Generates and persists AI daily summaries.
/// Called automatically at day boundaries or manually from Settings.
final class DailySummaryGenerator {
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

    // MARK: - Generate

    /// Generates (or regenerates) the AI daily summary for the given dateKey.
    /// Returns the narrative text.
    @discardableResult
    func generateSummary(for dateKey: String) async throws -> String {
        // Build data snapshot
        let snapshot = try aggregator.buildAIDataSnapshot(for: dateKey)

        // Verify there's enough data to summarize
        let totalSeconds = snapshot["totalActiveSeconds"] as? Double ?? 0
        guard totalSeconds > 60 else {
            return "Not enough activity recorded on \(dateKey) to generate a summary."
        }

        // Call AI
        let prompt = PromptTemplates.dailySummaryPrompt(dataSnapshot: snapshot)
        let narrative = try await client.complete(
            systemPrompt: PromptTemplates.systemPrompt,
            userPrompt: prompt,
            maxTokens: 300
        )

        // Persist
        var summary = try insightRepo.dailySummary(for: dateKey) ?? DailySummary(
            dateKey: dateKey,
            totalActiveSeconds: totalSeconds
        )
        summary.aiNarrative = narrative
        summary.aiModelUsed = client.selectedModel
        summary.generatedAt = Date().timeIntervalSince1970
        summary.totalActiveSeconds = totalSeconds

        // Attach aggregated metrics
        let focusScore = try aggregator.focusScore(for: dateKey)
        let switchCount = try aggregator.contextSwitchCount(for: dateKey)
        let topApps = try aggregator.topApps(for: dateKey, limit: 5)
        let topSites = try aggregator.topWebsites(for: dateKey, limit: 5)

        summary.focusScore = focusScore
        summary.fragmentCount = switchCount

        let appsJson = (try? JSONEncoder().encode(topApps.map {
            AppUsageEntry(bundleId: $0.appBundleId, name: $0.appName, seconds: $0.totalSeconds)
        })).flatMap { String(data: $0, encoding: .utf8) }
        summary.topAppsJson = appsJson

        let sitesJson = (try? JSONEncoder().encode(topSites.map {
            SiteUsageEntry(domain: $0.domain, seconds: $0.totalSeconds)
        })).flatMap { String(data: $0, encoding: .utf8) }
        summary.topSitesJson = sitesJson

        try insightRepo.saveDailySummary(summary)

        return narrative
    }

    // MARK: - Schedule

    /// Checks if today's summary needs generating (missing or older than 1 hour).
    func generateIfNeeded() async {
        let dateKey = AppSession.makeDateKey(from: Date().timeIntervalSince1970)
        do {
            let existing = try insightRepo.dailySummary(for: dateKey)
            let oneHourAgo = Date().timeIntervalSince1970 - 3600

            if let existing, let generatedAt = existing.generatedAt, generatedAt > oneHourAgo {
                return  // Summary is fresh enough
            }

            _ = try await generateSummary(for: dateKey)
        } catch {
            // Non-fatal: summary generation is best-effort
            print("[DailySummaryGenerator] Error: \(error)")
        }
    }
}
