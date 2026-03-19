import Foundation
import SwiftUI

/// ViewModel for the Websites view: website usage and selection.
@MainActor
final class WebsitesViewModel: ObservableObject {
    // MARK: - Published State

    @Published private(set) var websiteUsage: [(website: WebsiteRecord, duration: TimeInterval, sessionCount: Int)] = []
    @Published var selectedWebsite: WebsiteRecord?

    // MARK: - Dependencies

    private let store: ActivityStore?

    // MARK: - Init

    convenience init() {
        self.init(store: ServiceContainer.shared.store)
    }

    init(store: ActivityStore?) {
        self.store = store
    }

    // MARK: - Public Methods

    /// Load website usage for the default date range (last 7 days).
    func loadWebsites() {
        guard let store = store else { return }

        Task {
            let now = Date()
            let rangeStart = DateFormatters.startOfDay(now)
            let rangeEnd = DateFormatters.endOfDay(now)

            do {
                let durations = try await store.websiteDurations(from: rangeStart, to: rangeEnd)
                let sessions = try await store.fetchSessions(from: rangeStart, to: rangeEnd, significantOnly: true)

                var sessionCountByWebsite: [UUID: Int] = [:]
                for session in sessions {
                    if let wid = session.websiteId {
                        sessionCountByWebsite[wid, default: 0] += 1
                    }
                }

                let websites = try await store.fetchAllWebsites()
                let websiteLookup = Dictionary(uniqueKeysWithValues: websites.map { ($0.id, $0) })

                websiteUsage = durations.compactMap { (websiteId, domain, duration, category) in
                    guard duration >= TrackingRules.minimumWebVisitDuration,
                          let website = websiteLookup[websiteId] else { return nil }
                    let count = sessionCountByWebsite[websiteId] ?? 0
                    return (website: website, duration: duration, sessionCount: count)
                }

                if let selected = selectedWebsite,
                   !websiteUsage.contains(where: { $0.website.id == selected.id }) {
                    selectedWebsite = nil
                }
            } catch {
                websiteUsage = []
            }
        }
    }

    /// Select a website.
    func selectWebsite(_ website: WebsiteRecord?) {
        selectedWebsite = website
    }
}
