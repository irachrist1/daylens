import Foundation

struct WorkContextGrouper {
    private static let idleGapThreshold: TimeInterval = 15 * 60
    private static let meetingThreshold: TimeInterval = 20 * 60
    private static let longSingleAppThreshold: TimeInterval = 45 * 60
    private static let briefInterruptionThreshold: TimeInterval = 3 * 60
    private static let sustainedCategoryThreshold: TimeInterval = 15 * 60
    private static let communicationInterruptionThreshold: TimeInterval = 5 * 60
    private static let fastSwitchThreshold: TimeInterval = 5 * 60
    private static let slowSwitchThreshold: TimeInterval = 15 * 60

    /// Groups a chronologically ordered list of app sessions into coherent work context blocks.
    /// Sessions must be pre-sorted by startTime and already filtered for noise
    /// (use timelineEvents(for:) output as input, not raw app_sessions).
    static func group(sessions: [AppSession], websiteSummaries: [WebsiteUsageSummary]) -> [WorkContextBlock] {
        guard !sessions.isEmpty else { return [] }

        let segments = coarseSegments(from: sessions)
        let candidates = segments.flatMap { segment in
            analyze(
                sessions: segment.sessions,
                boundedBeforeGap: segment.boundedBeforeGap,
                boundedAfterGap: segment.boundedAfterGap
            )
        }

        return candidates.map { buildBlock(from: $0, websiteSummaries: websiteSummaries) }
    }

    private static func buildBlock(
        from candidate: CandidateBlock,
        websiteSummaries _: [WebsiteUsageSummary]
    ) -> WorkContextBlock {
        let sessions = candidate.sessions
        let startTime = sessions[0].startTime
        let endTime = sessions[sessions.count - 1].endTime
        let effectiveSessions = effectiveSessions(for: sessions)
        let distribution = categoryDistribution(for: effectiveSessions)
        let dominantCategory = dominantCategory(from: distribution)
        let coherence = coherenceScore(from: distribution)
        let switchCount = appSwitchCount(for: sessions)

        return WorkContextBlock(
            id: UUID(),
            startTime: startTime,
            endTime: endTime,
            dominantCategory: dominantCategory,
            categoryDistribution: distribution,
            ruleBasedLabel: label(
                for: candidate,
                dominantCategory: dominantCategory,
                coherence: coherence,
                switchCount: switchCount
            ),
            aiLabel: nil,
            sessions: sessions,
            topApps: topApps(from: sessions),
            websites: [],
            switchCount: switchCount,
            confidence: confidence(
                for: candidate,
                coherence: coherence,
                switchCount: switchCount
            ),
            isLive: false
        )
    }

    private static func coarseSegments(from sessions: [AppSession]) -> [CoarseSegment] {
        guard !sessions.isEmpty else { return [] }

        var segments: [CoarseSegment] = []
        var startIndex = 0

        for index in 1..<sessions.count {
            let gap = sessions[index].startTime.timeIntervalSince(sessions[index - 1].endTime)
            if gap > idleGapThreshold {
                segments.append(
                    CoarseSegment(
                        sessions: Array(sessions[startIndex..<index]),
                        boundedBeforeGap: startIndex > 0,
                        boundedAfterGap: true
                    )
                )
                startIndex = index
            }
        }

        segments.append(
            CoarseSegment(
                sessions: Array(sessions[startIndex...]),
                boundedBeforeGap: startIndex > 0,
                boundedAfterGap: false
            )
        )

        return segments
    }

    private static func analyze(
        sessions: [AppSession],
        boundedBeforeGap: Bool,
        boundedAfterGap: Bool
    ) -> [CandidateBlock] {
        guard !sessions.isEmpty else { return [] }

        if let firstMeetingIndex = sessions.firstIndex(where: isStandaloneMeeting) {
            var blocks: [CandidateBlock] = []

            let before = Array(sessions[..<firstMeetingIndex])
            if !before.isEmpty {
                blocks.append(
                    contentsOf: analyze(
                        sessions: before,
                        boundedBeforeGap: boundedBeforeGap,
                        boundedAfterGap: false
                    )
                )
            }

            let meeting = sessions[firstMeetingIndex]
            blocks.append(
                CandidateBlock(
                    sessions: [meeting],
                    formation: .meeting,
                    boundedBeforeGap: firstMeetingIndex == 0 ? boundedBeforeGap : false,
                    boundedAfterGap: firstMeetingIndex == sessions.count - 1 ? boundedAfterGap : false,
                    forcedLabel: meetingLabel(for: meeting)
                )
            )

            let afterStart = sessions.index(after: firstMeetingIndex)
            if afterStart < sessions.count {
                blocks.append(
                    contentsOf: analyze(
                        sessions: Array(sessions[afterStart...]),
                        boundedBeforeGap: false,
                        boundedAfterGap: boundedAfterGap
                    )
                )
            }

            return blocks
        }

        if let streak = longSingleAppStreak(in: sessions) {
            var blocks: [CandidateBlock] = []

            if streak.range.lowerBound > 0 {
                blocks.append(
                    contentsOf: analyze(
                        sessions: Array(sessions[..<streak.range.lowerBound]),
                        boundedBeforeGap: boundedBeforeGap,
                        boundedAfterGap: false
                    )
                )
            }

            blocks.append(
                CandidateBlock(
                    sessions: Array(sessions[streak.range]),
                    formation: .longSingleApp,
                    boundedBeforeGap: streak.range.lowerBound == 0 ? boundedBeforeGap : false,
                    boundedAfterGap: streak.range.upperBound == sessions.count ? boundedAfterGap : false,
                    forcedLabel: streak.label
                )
            )

            if streak.range.upperBound < sessions.count {
                blocks.append(
                    contentsOf: analyze(
                        sessions: Array(sessions[streak.range.upperBound...]),
                        boundedBeforeGap: false,
                        boundedAfterGap: boundedAfterGap
                    )
                )
            }

            return blocks
        }

        let effectiveSessions = effectiveSessions(for: sessions)
        let distribution = categoryDistribution(for: effectiveSessions)
        let dominant = dominantCategory(from: distribution)
        let coherence = coherenceScore(from: distribution)
        let averageDwell = averageDwellTime(for: sessions)
        let categoryRuns = categoryRuns(for: effectiveSessions)

        if coherence < 0.40,
           let splitIndex = sustainedDifferentCategorySplitIndex(
               runs: categoryRuns,
               dominantCategory: dominant
           ) {
            return splitAndAnalyze(
                sessions: sessions,
                splitIndex: splitIndex,
                boundedBeforeGap: boundedBeforeGap,
                boundedAfterGap: boundedAfterGap
            )
        }

        if coherence >= 0.40, coherence <= 0.75 {
            if isDeveloperTestingFlow(
                categories: Set(distribution.keys),
                averageDwell: averageDwell
            ) {
                return [
                    CandidateBlock(
                        sessions: sessions,
                        formation: .heuristic,
                        boundedBeforeGap: boundedBeforeGap,
                        boundedAfterGap: boundedAfterGap
                    )
                ]
            }

            if averageDwell > slowSwitchThreshold,
               let splitIndex = slowSwitchBoundaryIndex(runs: categoryRuns) {
                return splitAndAnalyze(
                    sessions: sessions,
                    splitIndex: splitIndex,
                    boundedBeforeGap: boundedBeforeGap,
                    boundedAfterGap: boundedAfterGap
                )
            }
        }

        let formation: FormationReason
        if coherence > 0.75 {
            formation = .coherent
        } else if coherence < 0.40 {
            formation = .fragmented
        } else {
            formation = .heuristic
        }

        return [
            CandidateBlock(
                sessions: sessions,
                formation: formation,
                boundedBeforeGap: boundedBeforeGap,
                boundedAfterGap: boundedAfterGap
            )
        ]
    }

    private static func splitAndAnalyze(
        sessions: [AppSession],
        splitIndex: Int,
        boundedBeforeGap: Bool,
        boundedAfterGap: Bool
    ) -> [CandidateBlock] {
        guard splitIndex > 0, splitIndex < sessions.count else {
            return [
                CandidateBlock(
                    sessions: sessions,
                    formation: .heuristic,
                    boundedBeforeGap: boundedBeforeGap,
                    boundedAfterGap: boundedAfterGap
                )
            ]
        }

        return analyze(
            sessions: Array(sessions[..<splitIndex]),
            boundedBeforeGap: boundedBeforeGap,
            boundedAfterGap: false
        ) + analyze(
            sessions: Array(sessions[splitIndex...]),
            boundedBeforeGap: false,
            boundedAfterGap: boundedAfterGap
        )
    }

    private static func effectiveSessions(for sessions: [AppSession]) -> [EffectiveSession] {
        guard sessions.count > 2 else {
            return sessions.map { EffectiveSession(session: $0, effectiveCategory: $0.category) }
        }

        var effectiveCategories = sessions.map(\.category)
        for index in 1..<(sessions.count - 1) {
            let session = sessions[index]
            guard (session.category == .communication || session.category == .email),
                  session.duration < communicationInterruptionThreshold else {
                continue
            }

            let previousCategory = effectiveCategories[index - 1]
            let nextCategory = effectiveCategories[index + 1]
            guard previousCategory == nextCategory, previousCategory != session.category else {
                continue
            }

            effectiveCategories[index] = previousCategory
        }

        return zip(sessions, effectiveCategories).map { EffectiveSession(session: $0.0, effectiveCategory: $0.1) }
    }

    private static func categoryDistribution(for sessions: [EffectiveSession]) -> [AppCategory: TimeInterval] {
        sessions.reduce(into: [:]) { distribution, entry in
            distribution[entry.effectiveCategory, default: 0] += entry.session.duration
        }
    }

    private static func dominantCategory(from distribution: [AppCategory: TimeInterval]) -> AppCategory {
        distribution
            .sorted { lhs, rhs in
                if lhs.value == rhs.value {
                    if lhs.key.isFocused != rhs.key.isFocused {
                        return lhs.key.isFocused && !rhs.key.isFocused
                    }
                    return lhs.key.rawValue.localizedCaseInsensitiveCompare(rhs.key.rawValue) == .orderedAscending
                }
                return lhs.value > rhs.value
            }
            .first?
            .key ?? .uncategorized
    }

    private static func coherenceScore(from distribution: [AppCategory: TimeInterval]) -> Double {
        let totalDuration = distribution.values.reduce(0, +)
        guard totalDuration > 0 else { return 0 }
        return (distribution.values.max() ?? 0) / totalDuration
    }

    private static func averageDwellTime(for sessions: [AppSession]) -> TimeInterval {
        guard !sessions.isEmpty else { return 0 }
        let totalDuration = sessions.reduce(0) { $0 + $1.duration }
        return totalDuration / Double(sessions.count)
    }

    private static func appSwitchCount(for sessions: [AppSession]) -> Int {
        guard sessions.count > 1 else { return 0 }
        return zip(sessions, sessions.dropFirst()).reduce(0) { count, pair in
            count + (pair.0.bundleID == pair.1.bundleID ? 0 : 1)
        }
    }

    private static func categoryRuns(for sessions: [EffectiveSession]) -> [CategoryRun] {
        guard let first = sessions.first else { return [] }

        var runs: [CategoryRun] = []
        var startIndex = 0
        var currentCategory = first.effectiveCategory
        var duration = first.session.duration

        for index in 1..<sessions.count {
            let session = sessions[index]
            if session.effectiveCategory == currentCategory {
                duration += session.session.duration
                continue
            }

            runs.append(
                CategoryRun(
                    category: currentCategory,
                    startIndex: startIndex,
                    totalDuration: duration
                )
            )
            startIndex = index
            currentCategory = session.effectiveCategory
            duration = session.session.duration
        }

        runs.append(
            CategoryRun(
                category: currentCategory,
                startIndex: startIndex,
                totalDuration: duration
            )
        )

        return runs
    }

    private static func sustainedDifferentCategorySplitIndex(
        runs: [CategoryRun],
        dominantCategory: AppCategory
    ) -> Int? {
        runs.first(where: {
            $0.startIndex > 0 &&
            $0.category != dominantCategory &&
            $0.totalDuration >= sustainedCategoryThreshold
        })?.startIndex
    }

    private static func slowSwitchBoundaryIndex(runs: [CategoryRun]) -> Int? {
        guard runs.count > 1 else { return nil }
        return runs.dropFirst().first?.startIndex
    }

    private static func isDeveloperTestingFlow(
        categories: Set<AppCategory>,
        averageDwell: TimeInterval
    ) -> Bool {
        guard averageDwell < fastSwitchThreshold, categories.contains(.development) else {
            return false
        }

        let devAndBrowsing: Set<AppCategory> = [.development, .browsing]
        let devAndResearch: Set<AppCategory> = [.development, .research]
        return categories.isSubset(of: devAndBrowsing) || categories.isSubset(of: devAndResearch)
    }

    private static func isStandaloneMeeting(_ session: AppSession) -> Bool {
        session.category == .meetings && session.duration >= meetingThreshold
    }

    private static func meetingLabel(for session: AppSession) -> String {
        let appName = session.appName.lowercased()
        if appName.contains("zoom") { return "Zoom Call" }
        if appName.contains("teams") { return "Teams Call" }
        if appName.contains("google meet") || appName.contains("meet") { return "Google Meet" }
        return "Meeting"
    }

    private static func label(
        for candidate: CandidateBlock,
        dominantCategory: AppCategory,
        coherence: Double,
        switchCount: Int
    ) -> String {
        if let forcedLabel = candidate.forcedLabel {
            return forcedLabel
        }

        let categories = Set(candidate.sessions.map(\.category))
        if coherence < 0.40 {
            return "Mixed Work"
        }

        if switchCount > 0,
           categories.contains(.development),
           (categories.contains(.browsing) || categories.contains(.research)) {
            return switchCount >= 3 ? "Building & Testing" : "Development"
        }

        if dominantCategory == .communication || dominantCategory == .email {
            return "Communication"
        }

        let focusedCategories = categories.filter(\.isFocused)
        if focusedCategories.count > 1 {
            return dominantCategory.rawValue
        }

        return dominantCategory.rawValue
    }

    private static func confidence(
        for candidate: CandidateBlock,
        coherence: Double,
        switchCount: Int
    ) -> BlockConfidence {
        if candidate.formation == .coherent,
           candidate.boundedBeforeGap && candidate.boundedAfterGap && coherence > 0.75 {
            return .high
        }

        if candidate.formation == .fragmented && coherence < 0.40 && switchCount >= 3 {
            return .low
        }

        return .medium
    }

    private static func longSingleAppStreak(in sessions: [AppSession]) -> AppStreak? {
        guard !sessions.isEmpty else { return nil }

        var bestStreak: AppStreak?

        for startIndex in sessions.indices {
            let targetBundleID = sessions[startIndex].bundleID
            var totalTargetDuration: TimeInterval = 0
            var bestEndIndexForStart: Int?

            for endIndex in startIndex..<sessions.count {
                let session = sessions[endIndex]
                if session.bundleID == targetBundleID {
                    totalTargetDuration += session.duration
                } else if isAllowedStreakInterruption(
                    sessions: sessions,
                    index: endIndex,
                    targetBundleID: targetBundleID
                ) {
                    continue
                } else {
                    break
                }

                if totalTargetDuration > longSingleAppThreshold {
                    bestEndIndexForStart = endIndex
                }
            }

            guard let endIndex = bestEndIndexForStart else { continue }

            let streak = AppStreak(
                range: startIndex..<(endIndex + 1),
                targetDuration: totalTargetDuration,
                label: sessions[startIndex].appName
            )

            if let currentBest = bestStreak {
                if streak.targetDuration > currentBest.targetDuration {
                    bestStreak = streak
                }
            } else {
                bestStreak = streak
            }
        }

        return bestStreak
    }

    private static func isAllowedStreakInterruption(
        sessions: [AppSession],
        index: Int,
        targetBundleID: String
    ) -> Bool {
        let session = sessions[index]
        if session.duration < briefInterruptionThreshold {
            return true
        }

        guard index > 0,
              index < sessions.count - 1,
              (session.category == .communication || session.category == .email),
              session.duration < communicationInterruptionThreshold else {
            return false
        }

        return sessions[index - 1].bundleID == targetBundleID &&
            sessions[index + 1].bundleID == targetBundleID
    }

    private static func topApps(from sessions: [AppSession]) -> [AppUsageSummary] {
        struct AppAccumulator {
            let bundleID: String
            let appName: String
            let category: AppCategory
            let isBrowser: Bool
            var totalDuration: TimeInterval
            var sessionCount: Int
        }

        var grouped: [String: AppAccumulator] = [:]
        for session in sessions {
            if grouped[session.bundleID] == nil {
                grouped[session.bundleID] = AppAccumulator(
                    bundleID: session.bundleID,
                    appName: session.appName,
                    category: session.category,
                    isBrowser: session.isBrowser,
                    totalDuration: 0,
                    sessionCount: 0
                )
            }

            grouped[session.bundleID]?.totalDuration += session.duration
            grouped[session.bundleID]?.sessionCount += 1
        }

        return grouped.values
            .sorted { lhs, rhs in
                if lhs.totalDuration == rhs.totalDuration {
                    return lhs.appName.localizedCaseInsensitiveCompare(rhs.appName) == .orderedAscending
                }
                return lhs.totalDuration > rhs.totalDuration
            }
            .prefix(3)
            .map { summary in
                AppUsageSummary(
                    bundleID: summary.bundleID,
                    appName: summary.appName,
                    totalDuration: summary.totalDuration,
                    sessionCount: summary.sessionCount,
                    category: summary.category,
                    isBrowser: summary.isBrowser
                )
            }
    }
}

private extension WorkContextGrouper {
    struct CoarseSegment {
        let sessions: [AppSession]
        let boundedBeforeGap: Bool
        let boundedAfterGap: Bool
    }

    struct EffectiveSession {
        let session: AppSession
        let effectiveCategory: AppCategory
    }

    struct CandidateBlock {
        let sessions: [AppSession]
        let formation: FormationReason
        let boundedBeforeGap: Bool
        let boundedAfterGap: Bool
        var forcedLabel: String? = nil
    }

    struct CategoryRun {
        let category: AppCategory
        let startIndex: Int
        let totalDuration: TimeInterval
    }

    struct AppStreak {
        let range: Range<Int>
        let targetDuration: TimeInterval
        let label: String
    }

    enum FormationReason: Equatable {
        case coherent
        case heuristic
        case fragmented
        case meeting
        case longSingleApp
    }
}
