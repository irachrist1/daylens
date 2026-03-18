import Foundation
import Observation

@Observable
final class WebsitesViewModel {
    var summaries: [WebsiteUsageSummary] = []
    var isLoading = false

    func load(for date: Date) {
        isLoading = true
        Task { @MainActor in
            summaries = (try? AppDatabase.shared.websiteUsageSummaries(for: date)) ?? []
            isLoading = false
        }
    }
}
