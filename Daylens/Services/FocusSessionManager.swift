import Foundation
import Observation
import GRDB

enum FocusSessionStatus: String, Codable, DatabaseValueConvertible {
    case running
    case completed
    case stopped
}

enum FocusPhase: Equatable {
    case idle
    case focusing
    case onBreak
}

struct FocusSessionRecord: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: Int64?
    var date: Date
    var startTime: Date
    var endTime: Date?
    var label: String?
    var targetMinutes: Int
    var actualDuration: TimeInterval
    var status: FocusSessionStatus

    static let databaseTableName = "focus_sessions"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }

    var formattedActualDuration: String {
        let hours = Int(actualDuration) / 3600
        let minutes = (Int(actualDuration) % 3600) / 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        if minutes > 0 { return "\(minutes)m" }
        return "\(Int(actualDuration))s"
    }
}

/// Pomodoro-style focus timer with configurable duration, breaks, and crash recovery.
@Observable
final class FocusSessionManager {

    // MARK: - State

    var phase: FocusPhase = .idle
    var elapsed: TimeInterval = 0
    var breakElapsed: TimeInterval = 0
    var completedPomodoros: Int = 0

    // MARK: - Configuration (persisted)

    var targetMinutes: Int {
        didSet { UserDefaults.standard.set(targetMinutes, forKey: Keys.target) }
    }
    var breakMinutes: Int {
        didSet { UserDefaults.standard.set(breakMinutes, forKey: Keys.breakDur) }
    }
    var breaksEnabled: Bool {
        didSet { UserDefaults.standard.set(breaksEnabled, forKey: Keys.breaksOn) }
    }

    // MARK: - Callbacks

    var onTick: (() -> Void)?

    // MARK: - Private

    private var focusTimer: Timer?
    private var startedAt: Date?
    private let database: AppDatabase?
    private var persistedSession: FocusSessionRecord?
    private var currentLabel: String?

    // MARK: - Computed

    var isRunning: Bool { phase == .focusing }
    var isOnBreak: Bool { phase == .onBreak }

    var target: TimeInterval { TimeInterval(targetMinutes * 60) }
    var breakTarget: TimeInterval { TimeInterval(breakMinutes * 60) }

    var progress: Double { target > 0 ? min(elapsed / target, 1.0) : 0 }
    var breakProgress: Double { breakTarget > 0 ? min(breakElapsed / breakTarget, 1.0) : 0 }

    var formattedRemaining: String { countdown(max(0, target - elapsed)) }
    var formattedBreakRemaining: String { countdown(max(0, breakTarget - breakElapsed)) }
    var formattedElapsed: String { elapsed == 0 ? "0:00" : countdown(elapsed) }

    // MARK: - Init

    init(database: AppDatabase? = nil) {
        self.database = database
        let d = UserDefaults.standard
        self.targetMinutes = d.integer(forKey: Keys.target).positive ?? 25
        self.breakMinutes  = d.integer(forKey: Keys.breakDur).positive ?? 5
        self.breaksEnabled = d.object(forKey: Keys.breaksOn) as? Bool ?? true
        Task.detached(priority: .utility) { [weak self] in
            self?.recoverOrphanedSessions()
        }
    }

    // MARK: - Public API

    func start(label: String? = nil) {
        guard phase == .idle else { return }
        elapsed = 0
        startedAt = Date()
        currentLabel = normalizedLabel(label)
        phase = .focusing
        persistStartedSession()
        scheduleFocusTimer()
    }

    /// Backward-compat entry point used by sidebar quick-start.
    func start(minutes: Int, label: String? = nil) {
        targetMinutes = minutes
        start(label: label)
    }

    func stop() {
        switch phase {
        case .focusing: finalizeSession(status: .stopped)
        case .onBreak:  endBreak()
        case .idle:     break
        }
    }

    func skipBreak() {
        guard phase == .onBreak else { return }
        endBreak()
    }

    // MARK: - Private: focus timer

    private func scheduleFocusTimer() {
        focusTimer?.invalidate()
        focusTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, let s = self.startedAt else { return }
            self.elapsed = Date().timeIntervalSince(s)
            if self.elapsed >= self.target { self.onFocusComplete() }
            else { self.onTick?() }
        }
    }

    private func onFocusComplete() {
        finalizeSession(status: .completed)
        completedPomodoros += 1
        if breaksEnabled { startBreak() }
        // else: finalizeSession(.completed) left phase as-is, set idle
        else { phase = .idle; onTick?() }
    }

    // MARK: - Private: break timer

    private func startBreak() {
        breakElapsed = 0
        let breakStart = Date()
        phase = .onBreak
        onTick?()

        focusTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.breakElapsed = Date().timeIntervalSince(breakStart)
            if self.breakElapsed >= self.breakTarget { self.endBreak() }
            else { self.onTick?() }
        }
    }

    private func endBreak() {
        focusTimer?.invalidate()
        focusTimer = nil
        breakElapsed = 0
        phase = .idle
        onTick?()
    }

    // MARK: - Private: session persistence

    private func finalizeSession(status: FocusSessionStatus) {
        focusTimer?.invalidate()
        focusTimer = nil

        let finishedAt = Date()
        if let s = startedAt { elapsed = finishedAt.timeIntervalSince(s) }

        if var record = persistedSession, let s = startedAt {
            record.endTime = finishedAt
            record.actualDuration = finishedAt.timeIntervalSince(s)
            record.status = status
            try? database?.saveFocusSession(record)
            SyncUploader.shared.syncNow()
        }

        persistedSession = nil
        currentLabel = nil
        startedAt = nil
        if status == .stopped { phase = .idle }
        onTick?()
    }

    private func persistStartedSession() {
        guard let database, let startedAt else { return }
        var session = FocusSessionRecord(
            date: Calendar.current.startOfDay(for: startedAt),
            startTime: startedAt,
            endTime: nil,
            label: currentLabel,
            targetMinutes: targetMinutes,
            actualDuration: 0,
            status: .running
        )
        try? database.insertFocusSession(&session)
        persistedSession = session
        SyncUploader.shared.syncNow()
    }

    /// On launch, mark any left-over "running" sessions as stopped with actual wall-clock duration.
    private func recoverOrphanedSessions() {
        guard let database else { return }
        let now = Date()
        try? database.dbQueue.write { db in
            let rows = try Row.fetchAll(db, sql: "SELECT id, startTime FROM focus_sessions WHERE status = 'running'")
            for row in rows {
                guard let id: Int64 = row["id"],
                      let startTime: Date = row["startTime"] else { continue }
                let duration = max(0, now.timeIntervalSince(startTime))
                try db.execute(
                    sql: "UPDATE focus_sessions SET status = 'stopped', endTime = ?, actualDuration = ? WHERE id = ?",
                    arguments: [now, duration, id]
                )
            }
        }
    }

    // MARK: - Helpers

    private func countdown(_ t: TimeInterval) -> String {
        let m = Int(t) / 60, s = Int(t) % 60
        return String(format: "%d:%02d", m, s)
    }

    private func normalizedLabel(_ label: String?) -> String? {
        guard let trimmed = label?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private enum Keys {
        static let target   = "daylens_focus_target"
        static let breakDur = "daylens_focus_break"
        static let breaksOn = "daylens_focus_breaks_on"
    }
}

private extension Int {
    var positive: Int? { self > 0 ? self : nil }
}
