import Foundation

/// Converts raw ActivityEvents into meaningful Sessions.
///
/// Core responsibilities:
/// - Pairs activation/deactivation events into duration-based sessions
/// - Filters sub-threshold sessions (< 5s) from significance
/// - Merges rapid back-and-forth switches within the merge window (8s)
/// - Excludes idle time from active duration calculations
/// - Produces clean, trustworthy session data for dashboard display
///
/// IMPORTANT: openSessions state persists across batches so that an activation
/// in flush N and its deactivation in flush N+1 are correctly paired.
final class SessionNormalizer {
    private let preferences: TrackingPreferences

    /// Persistent state: tracks apps that have been activated but not yet deactivated.
    /// Survives across flush batches so activation/deactivation pairing works correctly.
    private var openSessions: [UUID: (event: ActivityEvent, start: Date)] = [:]

    init(preferences: TrackingPreferences = TrackingPreferences()) {
        self.preferences = preferences
    }

    /// Processes a batch of raw events into normalized sessions.
    /// Open sessions carry over to the next batch for proper pairing.
    func normalize(events: [ActivityEvent]) -> [Session] {
        guard !events.isEmpty else { return [] }

        let sorted = events.sorted { $0.timestamp < $1.timestamp }
        var rawSessions = buildRawSessions(from: sorted)
        rawSessions = applyIdleSubtraction(sessions: rawSessions, events: sorted)
        rawSessions = markSignificance(sessions: rawSessions)
        rawSessions = mergeSessions(rawSessions)
        rawSessions = rawSessions.filter { $0.duration >= 1.0 }

        return rawSessions
    }

    // MARK: - Phase 1: Build Raw Sessions

    /// Pairs app activation/deactivation events into raw session objects.
    /// Uses persistent openSessions state so pairs can span batches.
    private func buildRawSessions(from events: [ActivityEvent]) -> [Session] {
        var sessions: [Session] = []

        for event in events {
            switch event.eventType {
            case .appActivated:
                if let existing = openSessions.removeValue(forKey: event.appId) {
                    let duration = event.timestamp.timeIntervalSince(existing.start)
                    if duration >= 1.0 {
                        sessions.append(Session(
                            appId: existing.event.appId,
                            browserId: existing.event.browserId,
                            websiteId: existing.event.websiteId,
                            startTime: existing.start,
                            endTime: event.timestamp,
                            duration: duration,
                            source: existing.event.source,
                            confidence: existing.event.confidence,
                            category: .uncategorized
                        ))
                    }
                }
                openSessions[event.appId] = (event: event, start: event.timestamp)

            case .appDeactivated:
                if let open = openSessions.removeValue(forKey: event.appId) {
                    let duration = event.timestamp.timeIntervalSince(open.start)
                    guard duration > 0 else { continue }

                    let session = Session(
                        appId: event.appId,
                        browserId: event.browserId ?? open.event.browserId,
                        websiteId: event.websiteId ?? open.event.websiteId,
                        startTime: open.start,
                        endTime: event.timestamp,
                        duration: duration,
                        source: bestSource(open.event.source, event.source),
                        confidence: min(open.event.confidence, event.confidence),
                        category: .uncategorized
                    )
                    sessions.append(session)
                }

            case .tabChanged, .urlChanged, .windowChanged:
                if let existingOpen = openSessions[event.appId] {
                    let duration = event.timestamp.timeIntervalSince(existingOpen.start)
                    if duration > 0 {
                        let session = Session(
                            appId: event.appId,
                            browserId: existingOpen.event.browserId,
                            websiteId: existingOpen.event.websiteId,
                            startTime: existingOpen.start,
                            endTime: event.timestamp,
                            duration: duration,
                            source: bestSource(existingOpen.event.source, event.source),
                            confidence: min(existingOpen.event.confidence, event.confidence),
                            category: .uncategorized
                        )
                        sessions.append(session)
                    }

                    openSessions[event.appId] = (event: event, start: event.timestamp)
                }

            default:
                break
            }
        }

        return sessions.sorted { $0.startTime < $1.startTime }
    }

    // MARK: - Phase 2: Idle Subtraction

    /// Subtracts idle periods from overlapping sessions.
    private func applyIdleSubtraction(sessions: [Session], events: [ActivityEvent]) -> [Session] {
        let idlePeriods = extractIdlePeriods(from: events)
        guard !idlePeriods.isEmpty else { return sessions }

        return sessions.map { session in
            var idleOverlap: TimeInterval = 0

            for period in idlePeriods {
                let overlapStart = max(session.startTime, period.start)
                let overlapEnd = min(session.endTime, period.end)
                if overlapStart < overlapEnd {
                    idleOverlap += overlapEnd.timeIntervalSince(overlapStart)
                }
            }

            guard idleOverlap > 0 else { return session }

            var updated = session
            updated.idleDuration = idleOverlap
            updated.duration = max(0, session.duration - idleOverlap)
            return updated
        }
    }

    private func extractIdlePeriods(from events: [ActivityEvent]) -> [(start: Date, end: Date)] {
        var periods: [(start: Date, end: Date)] = []
        var idleStart: Date?

        for event in events {
            if event.eventType == .idleStart {
                idleStart = event.timestamp
            } else if event.eventType == .idleEnd, let start = idleStart {
                periods.append((start: start, end: event.timestamp))
                idleStart = nil
            }
        }

        if let start = idleStart {
            periods.append((start: start, end: Date()))
        }

        return periods
    }

    // MARK: - Phase 3: Significance

    /// Marks sessions as significant or not based on minimum duration threshold.
    private func markSignificance(sessions: [Session]) -> [Session] {
        sessions.map { session in
            var updated = session
            updated.isSignificant = session.duration >= preferences.effectiveMinAppUse
            return updated
        }
    }

    // MARK: - Phase 4: Merge

    /// Merges sessions for the same app/website that are separated by gaps
    /// shorter than the merge window (default 8 seconds).
    func mergeSessions(_ sessions: [Session]) -> [Session] {
        guard sessions.count > 1 else { return sessions }

        let sorted = sessions.sorted { $0.startTime < $1.startTime }
        var merged: [Session] = []
        var current = sorted[0]

        for i in 1..<sorted.count {
            let next = sorted[i]
            if current.canMerge(with: next, maxGap: preferences.effectiveMergeWindow) {
                current = current.merged(with: next)
            } else {
                merged.append(current)
                current = next
            }
        }
        merged.append(current)

        return merged
    }

    private func bestSource(_ a: CaptureSource, _ b: CaptureSource) -> CaptureSource {
        a.confidenceWeight >= b.confidenceWeight ? a : b
    }
}

// MARK: - Focus and Fragmentation Scoring

extension SessionNormalizer {
    /// Calculates a focus score (0.0 to 1.0) for a set of sessions.
    /// Higher score = more focused work (fewer switches, longer sessions).
    static func focusScore(for sessions: [Session]) -> Double {
        guard !sessions.isEmpty else { return 0 }

        let significantSessions = sessions.filter { $0.isSignificant }
        guard !significantSessions.isEmpty else { return 0 }

        let totalDuration = significantSessions.reduce(0.0) { $0 + $1.duration }
        guard totalDuration > 0 else { return 0 }

        let focusSessions = significantSessions.filter {
            $0.duration >= TrackingRules.focusSessionMinimum
                && $0.category.isFocusCategory
        }
        let focusDuration = focusSessions.reduce(0.0) { $0 + $1.duration }

        return min(1.0, focusDuration / totalDuration)
    }

    /// Calculates a fragmentation score (0.0 to 1.0) for a set of sessions.
    /// Higher score = more fragmented (many rapid switches between apps).
    static func fragmentationScore(for sessions: [Session]) -> Double {
        guard sessions.count > 1 else { return 0 }

        let sorted = sessions.sorted { $0.startTime < $1.startTime }
        var rapidSwitches = 0

        for i in 1..<sorted.count {
            let gap = sorted[i].startTime.timeIntervalSince(sorted[i - 1].endTime)
            if gap < TrackingRules.rapidSwitchThreshold && gap >= 0 {
                rapidSwitches += 1
            }
        }

        let switchRate = Double(rapidSwitches) / Double(sorted.count - 1)
        return min(1.0, switchRate)
    }
}
