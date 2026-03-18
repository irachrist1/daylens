import Foundation
import SwiftUI

/// ViewModel for the Apps view: app usage, selection, and sessions.
@MainActor
final class AppsViewModel: ObservableObject {
    // MARK: - Published State

    @Published private(set) var appUsage: [(app: AppRecord, duration: TimeInterval, sessionCount: Int)] = []
    @Published var selectedApp: AppRecord?
    @Published private(set) var appSessions: [Session] = []
    @Published var dateRange: (from: Date, to: Date)

    // MARK: - Dependencies

    private let store: ActivityStore

    // MARK: - Init

    init(store: ActivityStore, dateRange: (from: Date, to: Date)? = nil) {
        self.store = store
        let range = dateRange ?? {
            let end = Date()
            let start = Calendar.current.date(byAdding: .day, value: -7, to: end) ?? end
            return (start, end)
        }()
        self.dateRange = range
    }

    // MARK: - Public Methods

    /// Load app usage for the current date range.
    func loadApps() {
        Task {
            let start = DateFormatters.startOfDay(dateRange.from)
            let end = DateFormatters.endOfDay(dateRange.to)

            do {
                let durations = try await store.appDurations(from: start, to: end)
                let sessions = try await store.fetchSessions(from: start, to: end, significantOnly: true)

                var sessionCountByApp: [UUID: Int] = [:]
                for session in sessions {
                    sessionCountByApp[session.appId, default: 0] += 1
                }

                var usage: [(app: AppRecord, duration: TimeInterval, sessionCount: Int)] = []
                for (appId, name, duration, category) in durations {
                    guard duration >= TrackingRules.minimumAppUseDuration else { continue }

                    if let app = try await store.fetchApp(id: appId) {
                        let count = sessionCountByApp[appId] ?? 0
                        usage.append((app: app, duration: duration, sessionCount: count))
                    }
                }

                appUsage = usage

                if let selected = selectedApp,
                   let idx = usage.firstIndex(where: { $0.app.id == selected.id }) {
                    selectApp(usage[idx].app)
                } else {
                    appSessions = []
                }
            } catch {
                appUsage = []
                appSessions = []
            }
        }
    }

    /// Select an app and load its sessions for the date range.
    func selectApp(_ app: AppRecord?) {
        selectedApp = app

        guard let app = app else {
            appSessions = []
            return
        }

        Task {
            let start = DateFormatters.startOfDay(dateRange.from)
            let end = DateFormatters.endOfDay(dateRange.to)

            do {
                appSessions = try await store.fetchSessions(forApp: app.id, from: start, to: end)
            } catch {
                appSessions = []
            }
        }
    }
}
