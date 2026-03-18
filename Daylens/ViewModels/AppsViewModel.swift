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
            summaries = (try? AppDatabase.shared.appUsageSummaries(for: date)) ?? []
            isLoading = false
        }
    }
}
