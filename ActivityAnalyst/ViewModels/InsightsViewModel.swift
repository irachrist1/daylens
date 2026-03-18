import Foundation
import SwiftUI

/// ViewModel for the Insights view: insights and trends from daily summaries.
@MainActor
final class InsightsViewModel: ObservableObject {
    // MARK: - Published State

    @Published private(set) var insights: [Insight] = []
    @Published private(set) var recentSummaries: [DailySummary] = []

    // MARK: - Dependencies

    private let store: ActivityStore

    // MARK: - Init

    init(store: ActivityStore) {
        self.store = store
    }

    // MARK: - Public Methods

    /// Load insights from recent daily summaries.
    func loadInsights() {
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

    /// Load trends (recent summaries for trend visualization).
    func loadTrends() {
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
