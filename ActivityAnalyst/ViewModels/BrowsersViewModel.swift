import Foundation
import SwiftUI

/// ViewModel for the Browsers view: browser usage and selection.
@MainActor
final class BrowsersViewModel: ObservableObject {
    // MARK: - Published State

    @Published private(set) var browserUsage: [(browser: BrowserRecord, duration: TimeInterval)] = []
    @Published var selectedBrowser: BrowserRecord?

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

    /// Load browser usage for the default date range (last 7 days).
    func loadBrowsers() {
        guard let store = store else { return }

        Task {
            let end = Date()
            let start = Calendar.current.date(byAdding: .day, value: -7, to: end) ?? end
            let rangeStart = DateFormatters.startOfDay(start)
            let rangeEnd = DateFormatters.endOfDay(end)

            do {
                let durations = try await store.browserDurations(from: rangeStart, to: rangeEnd)
                let browsers = try await store.fetchAllBrowsers()
                let browserLookup = Dictionary(uniqueKeysWithValues: browsers.map { ($0.id, $0) })

                browserUsage = durations.compactMap { (browserId, name, duration) in
                    guard let browser = browserLookup[browserId] else { return nil }
                    return (browser: browser, duration: duration)
                }

                if let selected = selectedBrowser,
                   !browserUsage.contains(where: { $0.browser.id == selected.id }) {
                    selectedBrowser = nil
                }
            } catch {
                browserUsage = []
            }
        }
    }

    /// Select a browser.
    func selectBrowser(_ browser: BrowserRecord?) {
        selectedBrowser = browser
    }
}
