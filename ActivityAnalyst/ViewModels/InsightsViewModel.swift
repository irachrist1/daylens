import Foundation
import SwiftUI

/// ViewModel for the Insights view: insights and trends from daily summaries.
@MainActor
final class InsightsViewModel: ObservableObject {
    // MARK: - Published State

    @Published private(set) var insights: [Insight] = []
    @Published private(set) var recentSummaries: [DailySummary] = []
    @Published private(set) var isGeneratingInsights = false
    @Published var aiConfigured: Bool = false

    // MARK: - Dependencies

    private let store: ActivityStore?

    // MARK: - Init

    convenience init() {
        self.init(store: ServiceContainer.shared.store)
    }

    init(store: ActivityStore?) {
        self.store = store
        aiConfigured = ServiceContainer.shared.hasAI

        NotificationCenter.default.addObserver(
            forName: AppConstants.NotificationNames.apiKeyChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.aiConfigured = ServiceContainer.shared.hasAI
            }
        }
    }

    // MARK: - Public Methods

    /// Load insights from recent daily summaries.
    func loadInsights() {
        guard let store = store else { return }

        Task {
            let end = Date()
            let start = Calendar.current.date(byAdding: .day, value: -14, to: end) ?? end
            let rangeStart = DateFormatters.startOfDay(start)
            let rangeEnd = DateFormatters.endOfDay(end)

            do {
                let summaries = try await store.fetchDailySummaries(from: rangeStart, to: rangeEnd)
                recentSummaries = summaries

                var allInsights: [Insight] = []
                for summary in summaries {
                    let summaryInsights = try await store.fetchInsights(for: summary.id)
                    allInsights.append(contentsOf: summaryInsights)
                }
                insights = allInsights.sorted { $0.createdAt > $1.createdAt }
            } catch {
                insights = []
                recentSummaries = []
            }
        }
    }

    /// Generate trend insights from recent summaries using AI.
    func generateTrendInsights() {
        guard let store = store,
              let aiAnalyst = ServiceContainer.shared.aiAnalyst,
              !recentSummaries.isEmpty else { return }

        isGeneratingInsights = true

        Task {
            defer { isGeneratingInsights = false }

            do {
                let newInsights = try await aiAnalyst.analyzeTrends(summaries: recentSummaries)
                for insight in newInsights {
                    try await store.insertInsight(insight)
                }
                loadInsights()
            } catch {
                print("InsightsViewModel: Failed to generate trend insights: \(error)")
            }
        }
    }

    /// Load trends (recent summaries for trend visualization).
    func loadTrends() {
        guard let store = store else { return }

        Task {
            let end = Date()
            let start = Calendar.current.date(byAdding: .day, value: -30, to: end) ?? end
            let rangeStart = DateFormatters.startOfDay(start)
            let rangeEnd = DateFormatters.endOfDay(end)

            do {
                recentSummaries = try await store.fetchDailySummaries(from: rangeStart, to: rangeEnd)
            } catch {
                recentSummaries = []
            }
        }
    }
}
