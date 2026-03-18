import Foundation
import SwiftUI

/// ViewModel for the Timeline view: sessions for a selected day, grouped by hour.
@MainActor
final class TimelineViewModel: ObservableObject {
    // MARK: - Published State

    @Published private(set) var timelineSessions: [Session] = []
    @Published var selectedSession: Session?

    /// Sessions grouped by hour (0–23) for timeline display.
    var sessionsByHour: [(hour: Int, sessions: [Session])] {
        let grouped = Dictionary(grouping: timelineSessions) { session in
            Calendar.current.component(.hour, from: session.startTime)
        }
        return (0..<24).compactMap { hour in
            let sessions = grouped[hour] ?? []
            return (hour: hour, sessions: sessions)
        }
    }

    // MARK: - Dependencies

    private let store: ActivityStore?
    private var selectedDay: Date = Date()

    // MARK: - Init

    convenience init() {
        self.init(store: ServiceContainer.shared.store)
    }

    init(store: ActivityStore?) {
        self.store = store
    }

    // MARK: - Public Methods

    /// Load sessions for the given day.
    func loadSessions(for date: Date) {
        guard let store = store else { return }

        selectedDay = date
        let start = DateFormatters.startOfDay(date)
        let end = DateFormatters.endOfDay(date)

        Task {
            do {
                timelineSessions = try await store.fetchSessions(
                    from: start,
                    to: end,
                    significantOnly: false
                )
                if let selected = selectedSession,
                   !timelineSessions.contains(where: { $0.id == selected.id }) {
                    selectedSession = nil
                }
            } catch {
                timelineSessions = []
            }
        }
    }

    /// Update the selected day and reload.
    func setSelectedDay(_ date: Date) {
        loadSessions(for: date)
    }
}
