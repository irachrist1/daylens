import Foundation
import Observation

@Observable
final class HistoryViewModel {
    var dailySummaries: [DailySummary] = []
    var isLoading = false

    func load() {
        isLoading = true
        Task { @MainActor in
            dailySummaries = (try? AppDatabase.shared.recentDailySummaries(limit: 30)) ?? []
            isLoading = false
        }
    }
}
