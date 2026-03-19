import Foundation
import Observation

@Observable
final class AppsViewModel {
    var summaries: [AppUsageSummary] = []
    var selectedApp: AppUsageSummary?
    var isLoading = false

    func load(for date: Date) {
        isLoading = true
        Task { @MainActor in
            let summaries = (try? await Task.detached(priority: .userInitiated) {
                try AppDatabase.shared.appUsageSummaries(for: date)
            }.value) ?? []
            self.summaries = summaries
            isLoading = false
        }
    }
}
