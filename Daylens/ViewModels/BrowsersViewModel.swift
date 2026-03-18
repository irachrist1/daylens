import Foundation
import Observation

@Observable
final class BrowsersViewModel {
    var summaries: [BrowserUsageSummary] = []
    var isLoading = false

    func load(for date: Date) {
        isLoading = true
        Task { @MainActor in
            summaries = (try? AppDatabase.shared.browserUsageSummaries(for: date)) ?? []
            isLoading = false
        }
    }
}
