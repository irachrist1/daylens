import Foundation
import Observation

@Observable
final class FocusViewModel {

    // MARK: - Session history + stats

    var sessions: [FocusSessionRecord] = []
    var isLoading = false

    var completedSessions: [FocusSessionRecord] { sessions.filter { $0.status == .completed } }
    var totalFocusedTime: String { format(completedSessions.reduce(0) { $0 + $1.actualDuration }) }
    var completedCount: Int { completedSessions.count }
    var longestSession: String { format(completedSessions.map(\.actualDuration).max() ?? 0) }

    var currentStreakDays: Int {
        let days = Set(completedSessions.map { Calendar.current.startOfDay(for: $0.date) })
        guard !days.isEmpty else { return 0 }
        var streak = 0
        var day = Calendar.current.startOfDay(for: Date())
        while days.contains(day) {
            streak += 1
            guard let prev = Calendar.current.date(byAdding: .day, value: -1, to: day) else { break }
            day = prev
        }
        return streak
    }

    // MARK: - Work context blocks (for today's time-slot display)

    var workContextBlocks: [WorkContextBlock] = []
    var workHoursStart: Int = 9
    var workHoursEnd: Int = 18

    // MARK: - Focus slots (planned future work, UserDefaults-backed)

    var focusSlots: [FocusSlot] = []

    // MARK: - Active session (the currently running DB record)

    var activeFocusSession: FocusSessionRecord?

    // MARK: - Session manager reference (set by the view in onAppear)

    var sessionManager: FocusSessionManager?

    // MARK: - Load

    func load() {
        isLoading = true
        loadFocusSlotsFromDefaults()
        Task { @MainActor in
            defer { isLoading = false }
            let (loadedSessions, blocks, hoursStart, hoursEnd, active) =
                await Task.detached(priority: .userInitiated) { () -> ([FocusSessionRecord], [WorkContextBlock], Int, Int, FocusSessionRecord?) in
                    let db = AppDatabase.shared
                    let s = (try? db.recentFocusSessions(limit: 30)) ?? []
                    let today = Date()
                    let sessions = (try? db.timelineEvents(for: today)) ?? []
                    let websiteSummaries = (try? db.websiteUsageSummaries(for: today)) ?? []
                    let blocks = WorkContextGrouper.group(sessions: sessions, websiteSummaries: websiteSummaries)
                    let profile = try? db.fetchUserProfile()
                    let active = s.first { $0.status == .running }
                    return (s, blocks, profile?.workHoursStart ?? 9, profile?.workHoursEnd ?? 18, active)
                }.value
            sessions = loadedSessions
            workContextBlocks = blocks
            workHoursStart = hoursStart
            workHoursEnd = hoursEnd
            activeFocusSession = active
        }
    }

    // MARK: - Focus slot management

    func saveFocusSlot(_ slot: FocusSlot) {
        var updated = focusSlots.filter { $0.id != slot.id }
        updated.append(slot)
        focusSlots = updated.sorted { $0.slotStart < $1.slotStart }
        persistFocusSlots()
    }

    func deleteFocusSlot(id: UUID) {
        focusSlots.removeAll { $0.id == id }
        persistFocusSlots()
    }

    // MARK: - Focus session control

    func startFocusSession(label: String, durationMinutes: Int) {
        sessionManager?.start(minutes: durationMinutes, label: label.isEmpty ? nil : label)
    }

    func endFocusSession() {
        sessionManager?.stop()
    }

    // MARK: - Private helpers

    private func format(_ seconds: TimeInterval) -> String {
        guard seconds > 0 else { return "0m" }
        let h = Int(seconds) / 3600, m = (Int(seconds) % 3600) / 60
        if h > 0 { return "\(h)h \(m)m" }
        if m > 0 { return "\(m)m" }
        return "\(Int(seconds))s"
    }

    private var todayDateKey: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    private static let slotKeyPrefix = "daylens.focusSlots."

    private func loadFocusSlotsFromDefaults() {
        let key = Self.slotKeyPrefix + todayDateKey
        guard let data = UserDefaults.standard.data(forKey: key),
              let slots = try? JSONDecoder().decode([FocusSlot].self, from: data) else {
            focusSlots = []
            return
        }
        focusSlots = slots.sorted { $0.slotStart < $1.slotStart }
    }

    private func persistFocusSlots() {
        let key = Self.slotKeyPrefix + todayDateKey
        if let data = try? JSONEncoder().encode(focusSlots) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}
