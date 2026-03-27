import Foundation
import GRDB

/// All data needed to render a single day's dashboard.
struct CombinedDayPayload {
    let appSummaries: [AppUsageSummary]
    let appleLikeAppSummaries: [AppUsageSummary]
    let timeline: [AppSession]
    let websiteSummaries: [WebsiteUsageSummary]
    let browserSummaries: [BrowserUsageSummary]
    let dailySummary: DailySummary?
    let categoryOverrides: [String: AppCategory]
    let usageMetrics: DayUsageMetrics
}

private enum UsageProfile {
    case meaningful
    case appleLike
}

/// Reusable database query methods.
extension AppDatabase {

    // MARK: - Insert

    func insertEvent(_ event: ActivityEvent) throws {
        try dbQueue.write { db in
            try event.insert(db)
        }
    }

    func insertAppSession(_ session: AppSession) throws {
        try dbQueue.write { db in
            try session.insert(db)
        }
    }

    func insertBrowserSession(_ session: BrowserSession) throws {
        try dbQueue.write { db in
            try session.insert(db)
        }
    }

    func insertWebsiteVisit(_ visit: WebsiteVisit) throws {
        try dbQueue.write { db in
            try visit.insert(db)
        }
    }

    func insertFocusSession(_ session: inout FocusSessionRecord) throws {
        let rowID = try dbQueue.write { db -> Int64 in
            try session.insert(db)
            return db.lastInsertedRowID
        }
        session.id = rowID
    }

    func saveFocusSession(_ session: FocusSessionRecord) throws {
        try dbQueue.write { db in
            try session.save(db)
        }
    }

    func saveDailySummary(_ summary: DailySummary) throws {
        var summaryToSave = summary
        try dbQueue.write { db in
            let existing = try DailySummary
                .filter(Column("date") == summary.date)
                .fetchOne(db)

            if summaryToSave.aiSummary == nil {
                summaryToSave.aiSummary = existing?.aiSummary
                summaryToSave.aiSummaryGeneratedAt = existing?.aiSummaryGeneratedAt
            }

            try summaryToSave.save(db, onConflict: .replace)
        }
    }

    func saveUserProfile(_ profile: UserProfile) throws {
        let profileToSave = profile
        try dbQueue.write { db in
            if profileToSave.id == nil {
                try profileToSave.insert(db)
            } else {
                try profileToSave.save(db)
            }
        }
    }

    func fetchUserProfile() throws -> UserProfile? {
        try dbQueue.read { db in
            try UserProfile
                .order(Column("updatedAt").desc, Column("id").desc)
                .fetchOne(db)
        }
    }

    func updateUserProfile(_ profile: UserProfile) throws {
        try dbQueue.write { db in
            try profile.update(db)
        }
    }

    func deleteUserProfile() throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM user_profiles")
        }
    }

    func saveMemory(_ memory: UserMemory) throws {
        let memoryToSave = memory
        try dbQueue.write { db in
            if memoryToSave.id == nil {
                try memoryToSave.insert(db)
            } else {
                try memoryToSave.save(db)
            }
        }
    }

    func fetchRecentMemories(limit: Int) throws -> [UserMemory] {
        try dbQueue.read { db in
            try UserMemory
                .order(Column("createdAt").desc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    func deleteMemory(id: Int64) throws {
        try dbQueue.write { db in
            _ = try UserMemory.deleteOne(db, key: id)
        }
    }

    func saveReport(_ report: GeneratedReport) throws {
        let reportToSave = report
        try dbQueue.write { db in
            if reportToSave.id == nil {
                try reportToSave.insert(db)
            } else {
                try reportToSave.save(db)
            }
        }
    }

    func fetchReport(type: String, periodStart: Date) throws -> GeneratedReport? {
        try dbQueue.read { db in
            try GeneratedReport
                .filter(Column("reportType") == type && Column("periodStart") == periodStart)
                .order(Column("createdAt").desc, Column("id").desc)
                .fetchOne(db)
        }
    }

    func fetchRecentReports(limit: Int) throws -> [GeneratedReport] {
        try dbQueue.read { db in
            try GeneratedReport
                .order(Column("createdAt").desc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    // MARK: - App Sessions

    func appUsageSummaries(for date: Date, profile: UsageMetricMode = .meaningful) throws -> [AppUsageSummary] {
        try dbQueue.read { db in
            let overrides = (try? self.categoryOverrides(in: db)) ?? [:]
            return try self.appUsageSummaries(
                in: db,
                dayBounds: DayBounds(for: date),
                overrides: overrides,
                profile: usageProfile(for: profile)
            )
        }
    }

    // MARK: - Category Overrides

    func setCategoryOverride(bundleID: String, category: AppCategory) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "INSERT OR REPLACE INTO category_overrides (bundleID, category) VALUES (?, ?)",
                arguments: [bundleID, category.rawValue]
            )
        }
    }

    func removeCategoryOverride(bundleID: String) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "DELETE FROM category_overrides WHERE bundleID = ?",
                arguments: [bundleID]
            )
        }
    }

    // MARK: - Browser Sessions

    func browserUsageSummaries(for date: Date) throws -> [BrowserUsageSummary] {
        try dbQueue.read { db in
            try self.browserUsageSummaries(in: db, dayBounds: DayBounds(for: date))
        }
    }

    private func topDomains(in db: Database, dayBounds: DayBounds, browserBundleID: String, limit: Int) throws -> [String] {
        try websiteUsageSummaries(
            in: db,
            dayBounds: dayBounds,
            browserBundleID: browserBundleID,
            limit: limit
        ).map(\.domain)
    }

    // MARK: - Website Visits

    func websiteUsageSummaries(for date: Date) throws -> [WebsiteUsageSummary] {
        try dbQueue.read { db in
            try self.websiteUsageSummaries(in: db, dayBounds: DayBounds(for: date))
        }
    }

    // MARK: - Website Visits by Browser

    func websiteVisitsForBrowser(date: Date, browserBundleID: String, limit: Int = 20) throws -> [WebsiteUsageSummary] {
        try dbQueue.read { db in
            try self.websiteUsageSummaries(
                in: db,
                dayBounds: DayBounds(for: date),
                browserBundleID: browserBundleID,
                limit: limit
            )
        }
    }

    func topPagesByDomain(
        for date: Date,
        domains: [String],
        limitPerDomain: Int = 5
    ) throws -> [String: [WebsitePageSummary]] {
        try dbQueue.read { db in
            try self.topPagesByDomain(
                in: db,
                dayBounds: DayBounds(for: date),
                domains: domains,
                limitPerDomain: limitPerDomain
            )
        }
    }

    // MARK: - Daily Summary

    func dailySummary(for date: Date) throws -> DailySummary? {
        try dbQueue.read { db in
            let dayStart = Calendar.current.startOfDay(for: date)
            return try DailySummary.filter(Column("date") == dayStart).fetchOne(db)
        }
    }

    func recentDailySummaries(limit: Int = 7) throws -> [DailySummary] {
        try dbQueue.read { db in
            try DailySummary
                .order(Column("date").desc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    // MARK: - Timeline

    func timelineEvents(for date: Date) throws -> [AppSession] {
        try dbQueue.read { db in
            try self.timelineEvents(in: db, dayBounds: DayBounds(for: date))
        }
    }

    func appSessions(for date: Date, bundleID: String, profile: UsageMetricMode = .meaningful) throws -> [AppSession] {
        try dbQueue.read { db in
            let overrides = (try? self.categoryOverrides(in: db)) ?? [:]
            return try self.appSessions(
                in: db,
                dayBounds: DayBounds(for: date),
                bundleID: bundleID,
                overrides: overrides,
                profile: usageProfile(for: profile)
            )
        }
    }

    /// Single-read payload for a day: calls meaningfulAppSessions once, shares result between
    /// appSummaries and timeline, and batches all queries into one dbQueue.read snapshot.
    func combinedDayPayload(for date: Date) throws -> CombinedDayPayload {
        try dbQueue.read { db in
            let dayBounds = DayBounds(for: date)
            let overrides = (try? categoryOverrides(in: db)) ?? [:]
            let sessions = try normalizedAppSessions(in: db, dayBounds: dayBounds, overrides: overrides, profile: .meaningful)
            let appleLikeSessions = try normalizedAppSessions(in: db, dayBounds: dayBounds, overrides: overrides, profile: .appleLike)
            let appSummaries = appUsageSummariesFromSessions(sessions, overrides: overrides)
            let appleLikeAppSummaries = appUsageSummariesFromSessions(appleLikeSessions, overrides: overrides)
            let websiteSummaries = try websiteUsageSummaries(in: db, dayBounds: dayBounds)
            let browserSummaries = try browserUsageSummaries(in: db, dayBounds: dayBounds)
            let dailySummary = try DailySummary.filter(Column("date") == dayBounds.start).fetchOne(db)
            return CombinedDayPayload(
                appSummaries: appSummaries,
                appleLikeAppSummaries: appleLikeAppSummaries,
                timeline: sessions,
                websiteSummaries: websiteSummaries,
                browserSummaries: browserSummaries,
                dailySummary: dailySummary,
                categoryOverrides: overrides,
                usageMetrics: DayUsageMetrics(
                    meaningfulTotal: sessions.reduce(0) { $0 + $1.duration },
                    appleLikeTotal: appleLikeSessions.reduce(0) { $0 + $1.duration }
                )
            )
        }
    }

    func categoryOverrides() throws -> [String: AppCategory] {
        try dbQueue.read { db in try categoryOverrides(in: db) }
    }

    private func categoryOverrides(in db: Database) throws -> [String: AppCategory] {
        let rows = try Row.fetchAll(db, sql: "SELECT bundleID, category FROM category_overrides")
        var result: [String: AppCategory] = [:]
        for row in rows {
            let bundleID: String = row["bundleID"]
            let categoryString: String = row["category"]
            if let category = AppCategory(rawValue: categoryString) {
                result[bundleID] = category
            }
        }
        return result
    }

    /// Fast day-list snapshots using two SQL aggregation queries instead of one full read per day.
    /// Replaces calling trackedDays + daySummarySnapshot(for:) for each date.
    func trackedDaySnapshots(limit: Int = 60) throws -> [DaySummarySnapshot] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT DISTINCT date
                FROM app_sessions
                ORDER BY date DESC
                LIMIT ?
                """, arguments: [limit * 2])

            let dates = rows.compactMap { $0["date"] as Date? }.prefix(limit)
            let overrides = (try? categoryOverrides(in: db)) ?? [:]

            return try dates.compactMap { date in
                let snapshot = try self.daySummarySnapshot(in: db, for: date, overrides: overrides)
                return snapshot.totalActiveTime > 0 || snapshot.appleLikeTotalActiveTime > 0 ? snapshot : nil
            }
        }
    }

    func aiContextPayload(for date: Date) throws -> AIDayContextPayload {
        try dbQueue.read { db in
            let dayBounds = DayBounds(for: date)
            let overrides = (try? categoryOverrides(in: db)) ?? [:]
            return AIDayContextPayload(
                date: dayBounds.start,
                appSummaries: try self.appUsageSummaries(in: db, dayBounds: dayBounds, overrides: overrides, profile: .meaningful),
                websiteSummaries: try self.websiteUsageSummaries(in: db, dayBounds: dayBounds),
                browserSummaries: try self.browserUsageSummaries(in: db, dayBounds: dayBounds),
                dailySummary: try DailySummary.filter(Column("date") == dayBounds.start).fetchOne(db)
            )
        }
    }

    func recentAIPayloads(endingAt date: Date, limit: Int = 6) throws -> [AIDayContextPayload] {
        let dayStart = Calendar.current.startOfDay(for: date)
        let exclusion = MeaningfulActivityRules.sqlBundleIDExclusion
        let fetchLimit = max(limit * 3, limit)

        // Single atomic snapshot: discover tracked dates AND fetch payloads in one dbQueue.read.
        return try dbQueue.read { db in
            let dateRows = try Row.fetchAll(db, sql: """
                SELECT DISTINCT date
                FROM app_sessions
                WHERE bundleID NOT IN (\(exclusion))
                ORDER BY date DESC
                LIMIT \(fetchLimit)
                """)

            let dates = dateRows
                .compactMap { $0["date"] as Date? }
                .filter { $0 < dayStart }
                .prefix(limit)

            guard !dates.isEmpty else { return [] }

            let overrides = (try? self.categoryOverrides(in: db)) ?? [:]
            return dates.compactMap { pastDate -> AIDayContextPayload? in
                let dayBounds = DayBounds(for: pastDate)
                do {
                    return try AIDayContextPayload(
                        date: dayBounds.start,
                        appSummaries: self.appUsageSummaries(in: db, dayBounds: dayBounds, overrides: overrides, profile: .meaningful),
                        websiteSummaries: self.websiteUsageSummaries(in: db, dayBounds: dayBounds),
                        browserSummaries: self.browserUsageSummaries(in: db, dayBounds: dayBounds),
                        dailySummary: DailySummary.filter(Column("date") == dayBounds.start).fetchOne(db)
                    )
                } catch {
                    print("[Daylens] recentAIPayloads: skipping \(pastDate) — \(error)")
                    return nil
                }
            }
        }
    }

    // MARK: - Conversation Persistence

    func saveConversationTurn(question: String, answer: String, for date: Date) throws {
        let dayStart = Calendar.current.startOfDay(for: date)
        try dbQueue.write { db in
            try db.execute(
                sql: "INSERT INTO ai_conversations (createdAt, question, answer, date) VALUES (?, ?, ?, ?)",
                arguments: [Date(), question, answer, dayStart]
            )
        }
    }

    func loadRecentConversation(limit: Int = 30) throws -> [(question: String, answer: String)] {
        let rows = try dbQueue.read { db in
            try Row.fetchAll(db, sql: """
                SELECT question, answer FROM ai_conversations
                ORDER BY createdAt DESC
                LIMIT ?
                """, arguments: [limit])
        }
        return rows.reversed().map { (question: $0["question"], answer: $0["answer"]) }
    }

    func clearSavedConversation() throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM ai_conversations")
        }
    }

    // MARK: - AI Summary Persistence

    /// Persist an AI-generated summary for a specific day.
    /// Uses raw SQL upsert to guarantee the write succeeds regardless of
    /// whether a DailySummary row already exists.
    func saveAISummary(_ text: String, for date: Date) throws {
        let dayStart = Calendar.current.startOfDay(for: date)
        let generatedAt = Date()
        try dbQueue.write { db in
            // Try updating an existing row first
            try db.execute(
                sql: "UPDATE daily_summaries SET aiSummary = ?, aiSummaryGeneratedAt = ? WHERE date = ?",
                arguments: [text, generatedAt, dayStart]
            )
            if db.changesCount == 0 {
                let summary = try computedDailySummary(
                    in: db,
                    dayBounds: DayBounds(for: date),
                    aiSummary: text,
                    aiSummaryGeneratedAt: generatedAt
                )
                try summary.save(db, onConflict: .replace)
            }
        }
    }

    // MARK: - Tracked Days

    /// Returns dates that have at least one app session, most recent first.
    func trackedDays(limit: Int = 60) throws -> [Date] {
        try trackedDaySnapshots(limit: limit).map(\.date)
    }

    func focusSessions(for date: Date) throws -> [FocusSessionRecord] {
        try dbQueue.read { db in
            let dayBounds = DayBounds(for: date)
            return try FocusSessionRecord
                .filter(Column("startTime") >= dayBounds.start && Column("startTime") < dayBounds.end)
                .order(Column("startTime").asc)
                .fetchAll(db)
        }
    }

    func recentFocusSessions(limit: Int = 30) throws -> [FocusSessionRecord] {
        try dbQueue.read { db in
            try FocusSessionRecord
                .order(Column("startTime").desc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    /// Lightweight summary for a single day, computed from app_sessions.
    func daySummarySnapshot(for date: Date) throws -> DaySummarySnapshot {
        try dbQueue.read { db in
            try self.daySummarySnapshot(in: db, for: date)
        }
    }

    // MARK: - Cleanup

    func deleteDataOlderThan(days: Int) throws {
        try dbQueue.write { db in
            let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: Date())!
            try db.execute(sql: "DELETE FROM activity_events WHERE timestamp < ?", arguments: [cutoff])
            try db.execute(sql: "DELETE FROM app_sessions WHERE startTime < ?", arguments: [cutoff])
            try db.execute(sql: "DELETE FROM browser_sessions WHERE startTime < ?", arguments: [cutoff])
            try db.execute(sql: "DELETE FROM website_visits WHERE startTime < ?", arguments: [cutoff])
            try db.execute(sql: "DELETE FROM daily_summaries WHERE date < ?", arguments: [cutoff])
        }
    }

    func deleteAllData() throws {
        try dbQueue.write { db in
            try db.execute(sql: "DELETE FROM activity_events")
            try db.execute(sql: "DELETE FROM app_sessions")
            try db.execute(sql: "DELETE FROM browser_sessions")
            try db.execute(sql: "DELETE FROM website_visits")
            try db.execute(sql: "DELETE FROM daily_summaries")
            try db.execute(sql: "DELETE FROM ai_conversations")
        }
    }

    // MARK: - Export

    /// Export all data for a date range as a JSON-compatible dictionary.
    func exportData(from startDate: Date, to endDate: Date) throws -> [String: Any] {
        try dbQueue.read { db in
            let appSessions = try Row.fetchAll(db, sql: """
                SELECT * FROM app_sessions WHERE startTime >= ? AND startTime < ?
                ORDER BY startTime ASC
                """, arguments: [startDate, endDate])

            let websiteVisits = try Row.fetchAll(db, sql: """
                SELECT * FROM website_visits WHERE startTime >= ? AND startTime < ?
                ORDER BY startTime ASC
                """, arguments: [startDate, endDate])

            let dailySummaries = try Row.fetchAll(db, sql: """
                SELECT * FROM daily_summaries WHERE date >= ? AND date < ?
                ORDER BY date ASC
                """, arguments: [startDate, endDate])

            let browserSessions = try Row.fetchAll(db, sql: """
                SELECT * FROM browser_sessions WHERE startTime >= ? AND startTime < ?
                ORDER BY startTime ASC
                """, arguments: [startDate, endDate])

            let formatter = ISO8601DateFormatter()

            func rowToDict(_ row: Row) -> [String: Any] {
                var dict: [String: Any] = [:]
                for column in row.columnNames {
                    if let value = row[column] as? Date {
                        dict[column] = formatter.string(from: value)
                    } else if let value = row[column] as? String {
                        dict[column] = value
                    } else if let value = row[column] as? Int64 {
                        dict[column] = value
                    } else if let value = row[column] as? Double {
                        dict[column] = value
                    } else if let value = row[column] as? Bool {
                        dict[column] = value
                    }
                }
                return dict
            }

            return [
                "exportedAt": formatter.string(from: Date()),
                "dateRange": [
                    "from": formatter.string(from: startDate),
                    "to": formatter.string(from: endDate),
                ],
                "appSessions": appSessions.map(rowToDict),
                "browserSessions": browserSessions.map(rowToDict),
                "websiteVisits": websiteVisits.map(rowToDict),
                "dailySummaries": dailySummaries.map(rowToDict),
            ]
        }
    }
}

private struct DayBounds {
    let start: Date
    let end: Date

    init(for date: Date) {
        let dayStart = Calendar.current.startOfDay(for: date)
        self.start = dayStart
        self.end = Calendar.current.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart.addingTimeInterval(86400)
    }
}

private struct ClippedInterval {
    let start: Date
    let end: Date

    var duration: TimeInterval {
        end.timeIntervalSince(start)
    }
}

private struct RawWebsiteVisitInterval {
    let domain: String
    let bundleID: String
    let url: String?
    let title: String?
    let confidence: ActivityEvent.ConfidenceLevel
    let source: ActivityEvent.EventSource
    let interval: ClippedInterval
}

private struct EffectiveWebsiteInterval {
    let domain: String
    let bundleID: String
    let url: String?
    let title: String?
    let confidence: ActivityEvent.ConfidenceLevel
    let source: ActivityEvent.EventSource
    let interval: ClippedInterval
}

private struct RawAppSessionInterval {
    let id: Int64?
    let bundleID: String
    let appName: String
    let category: AppCategory
    let isBrowser: Bool
    let interval: ClippedInterval
}

private func clippedInterval(start: Date, end: Date, to dayBounds: DayBounds) -> ClippedInterval? {
    let clippedStart = max(start, dayBounds.start)
    let clippedEnd = min(end, dayBounds.end)
    guard clippedEnd > clippedStart else { return nil }
    return ClippedInterval(start: clippedStart, end: clippedEnd)
}

private func mergedIntervals(from intervals: [ClippedInterval], maxGap: TimeInterval = 0) -> [ClippedInterval] {
    let sorted = intervals.sorted { $0.start < $1.start }
    var merged: [ClippedInterval] = []

    for interval in sorted {
        if let last = merged.last,
           interval.start.timeIntervalSince(last.end) <= maxGap {
            merged[merged.count - 1] = ClippedInterval(
                start: last.start,
                end: max(last.end, interval.end)
            )
        } else {
            merged.append(interval)
        }
    }

    return merged
}

private func intersectedIntervals(_ interval: ClippedInterval, with bounds: [ClippedInterval]) -> [ClippedInterval] {
    bounds.compactMap { bound in
        let start = max(interval.start, bound.start)
        let end = min(interval.end, bound.end)
        guard end > start else { return nil }
        return ClippedInterval(start: start, end: end)
    }
}

private enum MeaningfulActivityRules {
    fileprivate static var sqlBundleIDExclusion: String {
        excludedBundleIDs.map { "'\($0)'" }.joined(separator: ", ")
    }

    private static let excludedBundleIDs: Set<String> = [
        "com.apple.loginwindow",
        "com.apple.dock",
        "com.apple.systemuiserver",
        "com.apple.notificationcenterui",
        "com.apple.controlcenter",
        "com.apple.screensaver.engine",
        "com.apple.backgroundtaskmanagementagent",
        "com.apple.usernotificationcenter",
        "com.apple.windowserver-target",
        "com.apple.accessibility.universalaccessd",
        "com.apple.screencontinuity",
        "com.apple.lockoutui",
        "com.apple.securityagent",
    ]

    private static let excludedAppNames: Set<String> = [
        "loginwindow",
        "windowserver",
        "universalaccessd",
        "control center",
        "notification center",
        "screen saver",
        "securityagent",
        "lock screen",
    ]

    static func shouldSurfaceAppSession(
        bundleID: String,
        appName: String,
        category: AppCategory,
        duration: TimeInterval,
        profile: UsageProfile = .meaningful
    ) -> Bool {
        let normalizedBundleID = bundleID.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedAppName = appName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        if excludedBundleIDs.contains(normalizedBundleID) {
            return false
        }

        if excludedAppNames.contains(normalizedAppName) {
            return false
        }

        if normalizedAppName.contains("lock screen") || normalizedAppName.contains("screen saver") {
            return false
        }

        if profile == .meaningful, category == .system && duration < 30 {
            return false
        }

        return duration > 0
    }
}

private extension AppDatabase {
    func browserUsageSummaries(in db: Database, dayBounds: DayBounds) throws -> [BrowserUsageSummary] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT browserBundleID, browserName, startTime, endTime
            FROM browser_sessions
            WHERE startTime < ? AND endTime > ?
            ORDER BY startTime ASC
            """, arguments: [dayBounds.end, dayBounds.start])

        struct BrowserAccumulator {
            let browserBundleID: String
            let browserName: String
            var totalDuration: TimeInterval
            var sessionCount: Int
        }

        var grouped: [String: BrowserAccumulator] = [:]
        for row in rows {
            let startTime: Date = row["startTime"]
            let endTime: Date = row["endTime"]
            guard let clipped = clippedInterval(start: startTime, end: endTime, to: dayBounds) else { continue }

            let bundleID: String = row["browserBundleID"]
            let browserName: String = row["browserName"]
            if grouped[bundleID] == nil {
                grouped[bundleID] = BrowserAccumulator(
                    browserBundleID: bundleID,
                    browserName: browserName,
                    totalDuration: 0,
                    sessionCount: 0
                )
            }
            grouped[bundleID]?.totalDuration += clipped.duration
            grouped[bundleID]?.sessionCount += 1
        }

        // Compute top domains for ALL browsers in a single SQL query instead of N per-browser queries.
        let topDomainRows = try Row.fetchAll(db, sql: """
            SELECT browserBundleID, domain, SUM(duration) AS total
            FROM website_visits
            WHERE startTime < ? AND endTime > ?
            GROUP BY browserBundleID, domain
            ORDER BY browserBundleID ASC, total DESC
            """, arguments: [dayBounds.end, dayBounds.start])

        var topDomainsByBrowser: [String: [String]] = [:]
        for row in topDomainRows {
            let bid: String = row["browserBundleID"]
            let domain: String = row["domain"]
            if (topDomainsByBrowser[bid]?.count ?? 0) < 3 {
                topDomainsByBrowser[bid, default: []].append(domain)
            }
        }

        return grouped.values
            .sorted { lhs, rhs in
                if lhs.totalDuration == rhs.totalDuration {
                    return lhs.browserName.localizedCaseInsensitiveCompare(rhs.browserName) == .orderedAscending
                }
                return lhs.totalDuration > rhs.totalDuration
            }
            .map { summary in
                BrowserUsageSummary(
                    browserBundleID: summary.browserBundleID,
                    browserName: summary.browserName,
                    totalDuration: summary.totalDuration,
                    sessionCount: summary.sessionCount,
                    topDomains: topDomainsByBrowser[summary.browserBundleID] ?? []
                )
            }
    }

    func daySummarySnapshot(in db: Database, for date: Date) throws -> DaySummarySnapshot {
        let overrides = (try? categoryOverrides(in: db)) ?? [:]
        return try daySummarySnapshot(in: db, for: date, overrides: overrides)
    }

    func daySummarySnapshot(in db: Database, for date: Date, overrides: [String: AppCategory]) throws -> DaySummarySnapshot {
        let dayBounds = DayBounds(for: date)
        let meaningfulSessions = try normalizedAppSessions(in: db, dayBounds: dayBounds, overrides: overrides, profile: .meaningful)
        let appleLikeSessions = try normalizedAppSessions(in: db, dayBounds: dayBounds, overrides: overrides, profile: .appleLike)
        let summaries = appUsageSummariesFromSessions(meaningfulSessions, overrides: overrides)
        let totalDuration = meaningfulSessions.reduce(0) { $0 + $1.duration }
        let appleLikeDuration = appleLikeSessions.reduce(0) { $0 + $1.duration }
        let topAppName = summaries.first?.appName
        let topAppBundleID = summaries.first?.bundleID
        let storedFocusScore = (try? DailySummary
            .filter(Column("date") == dayBounds.start)
            .fetchOne(db))?.focusScore ?? 0

        return DaySummarySnapshot(
            date: dayBounds.start,
            totalActiveTime: totalDuration,
            appleLikeTotalActiveTime: appleLikeDuration,
            appCount: summaries.count,
            topAppName: topAppName,
            topAppBundleID: topAppBundleID,
            focusScore: storedFocusScore
        )
    }

    func computedDailySummary(
        in db: Database,
        dayBounds: DayBounds,
        aiSummary: String?,
        aiSummaryGeneratedAt: Date?
    ) throws -> DailySummary {
        let overrides = (try? categoryOverrides(in: db)) ?? [:]
        let appSummaries = try appUsageSummaries(in: db, dayBounds: dayBounds, overrides: overrides, profile: .meaningful)
        let websiteSummaries = try websiteUsageSummaries(in: db, dayBounds: dayBounds)
        let timeline = try normalizedAppSessions(in: db, dayBounds: dayBounds, overrides: overrides, profile: .meaningful)

        let totalActiveTime = appSummaries.reduce(0) { $0 + $1.totalDuration }
        let contextSwitches = max(0, timeline.count - 1)
        let websiteFocusCredit = focusedWebsiteCredit(
            appSummaries: appSummaries,
            websiteSummaries: websiteSummaries
        )

        return DailySummary(
            date: dayBounds.start,
            totalActiveTime: totalActiveTime,
            totalIdleTime: 0,
            appCount: appSummaries.count,
            browserCount: try browserCount(in: db, dayBounds: dayBounds),
            domainCount: websiteSummaries.count,
            sessionCount: timeline.count,
            contextSwitches: contextSwitches,
            focusScore: computeFocusScore(
                for: timeline,
                totalTime: totalActiveTime,
                websiteFocusCredit: websiteFocusCredit
            ),
            longestFocusStreak: computeLongestFocusStreak(for: timeline),
            topAppBundleID: appSummaries.first?.bundleID,
            topDomain: websiteSummaries.first?.domain,
            aiSummary: aiSummary,
            aiSummaryGeneratedAt: aiSummaryGeneratedAt
        )
    }

    func meaningfulAppSessions(in db: Database, dayBounds: DayBounds, overrides: [String: AppCategory] = [:]) throws -> [AppSession] {
        try normalizedAppSessions(in: db, dayBounds: dayBounds, overrides: overrides, profile: .meaningful)
    }

    func timelineEvents(in db: Database, dayBounds: DayBounds) throws -> [AppSession] {
        try meaningfulAppSessions(in: db, dayBounds: dayBounds)
    }

    func appSessions(
        in db: Database,
        dayBounds: DayBounds,
        bundleID: String,
        overrides: [String: AppCategory] = [:],
        profile: UsageProfile = .meaningful
    ) throws -> [AppSession] {
        try normalizedAppSessions(in: db, dayBounds: dayBounds, overrides: overrides, profile: profile)
            .filter { $0.bundleID == bundleID }
    }

    func browserCount(in db: Database, dayBounds: DayBounds) throws -> Int {
        let rows = try Row.fetchAll(db, sql: """
            SELECT DISTINCT browserBundleID
            FROM browser_sessions
            WHERE startTime < ? AND endTime > ?
            """, arguments: [dayBounds.end, dayBounds.start])
        return rows.count
    }

    func computeFocusScore(
        for sessions: [AppSession],
        totalTime: TimeInterval,
        websiteFocusCredit: TimeInterval = 0
    ) -> Double {
        let focusedTime = sessions
            .filter { $0.category.isFocused }
            .reduce(0.0) { $0 + $1.duration }

        return FocusScoreCalculator.compute(
            focusedTime: focusedTime,
            totalTime: totalTime,
            sessionCount: sessions.count,
            websiteFocusCredit: websiteFocusCredit
        )
    }

    func focusedWebsiteCredit(
        appSummaries: [AppUsageSummary],
        websiteSummaries: [WebsiteUsageSummary]
    ) -> TimeInterval {
        let browserTotal = appSummaries
            .filter { $0.category == .browsing }
            .reduce(0.0) { $0 + $1.totalDuration }
        let webFocused = websiteSummaries
            .filter { DomainIntelligence.classify(domain: $0.domain).category.isFocused }
            .reduce(0.0) { $0 + $1.totalDuration }
        return min(webFocused, browserTotal)
    }

    func computeLongestFocusStreak(for sessions: [AppSession]) -> TimeInterval {
        var longestStreak: TimeInterval = 0
        var currentStreak: TimeInterval = 0
        var lastEndTime: Date?

        for session in sessions where session.category.isFocused {
            if let lastEnd = lastEndTime,
               session.startTime.timeIntervalSince(lastEnd) <= Constants.sessionMergeThreshold {
                currentStreak += session.duration
            } else {
                currentStreak = session.duration
            }
            lastEndTime = session.endTime
            longestStreak = max(longestStreak, currentStreak)
        }

        return longestStreak
    }

    func appUsageSummaries(
        in db: Database,
        dayBounds: DayBounds,
        overrides: [String: AppCategory] = [:],
        profile: UsageProfile = .meaningful
    ) throws -> [AppUsageSummary] {
        let sessions = try normalizedAppSessions(in: db, dayBounds: dayBounds, overrides: overrides, profile: profile)
        return appUsageSummariesFromSessions(sessions, overrides: overrides)
    }

    /// Pure aggregation — no DB access. Shared by appUsageSummaries and combinedDayPayload.
    func appUsageSummariesFromSessions(_ sessions: [AppSession], overrides: [String: AppCategory] = [:]) -> [AppUsageSummary] {
        struct AppAccumulator {
            let bundleID: String
            let appName: String
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
            .map { summary in
                AppUsageSummary(
                    bundleID: summary.bundleID,
                    appName: summary.appName,
                    totalDuration: summary.totalDuration,
                    sessionCount: summary.sessionCount,
                    category: overrides[summary.bundleID] ?? AppCategory.categorize(bundleID: summary.bundleID, appName: summary.appName),
                    isBrowser: summary.isBrowser
                )
            }
    }

    func usageProfile(for mode: UsageMetricMode) -> UsageProfile {
        switch mode {
        case .meaningful: .meaningful
        case .appleLike: .appleLike
        }
    }

    func normalizedAppSessions(
        in db: Database,
        dayBounds: DayBounds,
        overrides: [String: AppCategory],
        profile: UsageProfile
    ) throws -> [AppSession] {
        let rawSessions = try rawAppSessionIntervals(in: db, dayBounds: dayBounds, overrides: overrides, profile: profile)
        guard !rawSessions.isEmpty else { return [] }

        let idleIntervals = profile == .meaningful ? try inputIdleIntervals(in: db, dayBounds: dayBounds) : []
        let boundaryDates = Set(rawSessions.flatMap { [$0.interval.start, $0.interval.end] } + idleIntervals.flatMap { [$0.start, $0.end] })
        let sortedBoundaries = boundaryDates.sorted()
        guard sortedBoundaries.count >= 2 else { return [] }

        var resolved: [AppSession] = []
        for index in 0..<(sortedBoundaries.count - 1) {
            let segmentStart = sortedBoundaries[index]
            let segmentEnd = sortedBoundaries[index + 1]
            guard segmentEnd > segmentStart else { continue }

            let segment = ClippedInterval(start: segmentStart, end: segmentEnd)
            if profile == .meaningful, idleIntervals.contains(where: { $0.start <= segment.start && $0.end >= segment.end }) {
                continue
            }

            let covering = rawSessions.filter { $0.interval.start < segment.end && $0.interval.end > segment.start }
            guard let chosen = covering.max(by: preferredAppInterval) else { continue }

            resolved.append(
                AppSession(
                    id: chosen.id,
                    date: dayBounds.start,
                    bundleID: chosen.bundleID,
                    appName: chosen.appName,
                    startTime: segment.start,
                    endTime: segment.end,
                    duration: segment.duration,
                    category: chosen.category,
                    isBrowser: chosen.isBrowser
                )
            )
        }

        return mergeNormalizedAppSessions(resolved)
    }

    func rawAppSessionIntervals(
        in db: Database,
        dayBounds: DayBounds,
        overrides: [String: AppCategory],
        profile: UsageProfile
    ) throws -> [RawAppSessionInterval] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT id, bundleID, appName, startTime, endTime, duration, category, isBrowser
            FROM app_sessions
            WHERE startTime < ? AND endTime > ?
            ORDER BY startTime ASC, endTime ASC
            """, arguments: [dayBounds.end, dayBounds.start])

        return rows.compactMap { row in
            let bundleID: String = row["bundleID"]
            let appName: String = row["appName"]
            let startTime: Date = row["startTime"]
            let endTime: Date = row["endTime"]
            guard let clipped = clippedInterval(start: startTime, end: endTime, to: dayBounds) else {
                return nil
            }

            let storedCategory = AppCategory(rawValue: row["category"] as String) ?? .uncategorized
            let category: AppCategory
            if let override = overrides[bundleID] {
                category = override
            } else if storedCategory == .uncategorized {
                category = AppCategory.categorize(bundleID: bundleID, appName: appName)
            } else {
                category = storedCategory
            }

            guard MeaningfulActivityRules.shouldSurfaceAppSession(
                bundleID: bundleID,
                appName: appName,
                category: category,
                duration: clipped.duration,
                profile: profile
            ) else {
                return nil
            }

            return RawAppSessionInterval(
                id: row["id"],
                bundleID: bundleID,
                appName: appName,
                category: category,
                isBrowser: row["isBrowser"],
                interval: clipped
            )
        }
    }

    func inputIdleIntervals(in db: Database, dayBounds: DayBounds) throws -> [ClippedInterval] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT timestamp, eventType
            FROM activity_events
            WHERE timestamp < ? AND timestamp >= ?
              AND eventType IN ('idle_start', 'idle_end')
            ORDER BY timestamp ASC
            """, arguments: [dayBounds.end, dayBounds.start.addingTimeInterval(-12 * 3600)])

        var idleStart: Date?
        var intervals: [ClippedInterval] = []
        for row in rows {
            let timestamp: Date = row["timestamp"]
            let eventType = ActivityEvent.EventType(rawValue: row["eventType"] as String)

            switch eventType {
            case .idleStart:
                idleStart = timestamp
            case .idleEnd:
                if let idleStart,
                   let clipped = clippedInterval(start: idleStart, end: timestamp, to: dayBounds) {
                    intervals.append(clipped)
                }
                idleStart = nil
            case .none, .appActivated, .appDeactivated, .websiteVisit:
                break
            }
        }

        if let idleStart,
           let clipped = clippedInterval(start: idleStart, end: dayBounds.end, to: dayBounds) {
            intervals.append(clipped)
        }

        return mergedIntervals(from: intervals, maxGap: 0)
    }

    func preferredAppInterval(_ lhs: RawAppSessionInterval, _ rhs: RawAppSessionInterval) -> Bool {
        if lhs.interval.start != rhs.interval.start {
            return lhs.interval.start < rhs.interval.start
        }
        if lhs.interval.end != rhs.interval.end {
            return lhs.interval.end < rhs.interval.end
        }
        return (lhs.id ?? 0) < (rhs.id ?? 0)
    }

    func mergeNormalizedAppSessions(_ sessions: [AppSession]) -> [AppSession] {
        let sorted = sessions.sorted { lhs, rhs in
            if lhs.startTime == rhs.startTime {
                return lhs.endTime < rhs.endTime
            }
            return lhs.startTime < rhs.startTime
        }
        var merged: [AppSession] = []
        let jitterMergeThreshold: TimeInterval = 1.5

        for session in sorted {
            guard let last = merged.last else {
                merged.append(session)
                continue
            }

            let isSameApp = last.bundleID == session.bundleID && last.appName == session.appName
            let gap = session.startTime.timeIntervalSince(last.endTime)
            guard isSameApp, gap <= jitterMergeThreshold else {
                merged.append(session)
                continue
            }

            merged[merged.count - 1] = AppSession(
                id: last.id,
                date: last.date,
                bundleID: last.bundleID,
                appName: last.appName,
                startTime: last.startTime,
                endTime: session.endTime,
                duration: session.endTime.timeIntervalSince(last.startTime),
                category: last.category,
                isBrowser: last.isBrowser
            )
        }

        return merged
    }

    func websiteUsageSummaries(
        in db: Database,
        dayBounds: DayBounds,
        browserBundleID: String? = nil,
        limit: Int? = nil
    ) throws -> [WebsiteUsageSummary] {
        let rows: [Row]
        if let browserBundleID {
            rows = try Row.fetchAll(db, sql: """
                SELECT domain, fullURL, browserBundleID, confidence, source, pageTitle, startTime, endTime
                FROM website_visits
                WHERE startTime < ? AND endTime > ? AND browserBundleID = ?
                ORDER BY domain ASC, startTime ASC
                """, arguments: [dayBounds.end, dayBounds.start, browserBundleID])
        } else {
            rows = try Row.fetchAll(db, sql: """
                SELECT domain, fullURL, browserBundleID, confidence, source, pageTitle, startTime, endTime
                FROM website_visits
                WHERE startTime < ? AND endTime > ?
                ORDER BY domain ASC, startTime ASC
                """, arguments: [dayBounds.end, dayBounds.start])
        }

        let browserForegrounds = try foregroundBrowserIntervals(
            in: db,
            dayBounds: dayBounds,
            browserBundleID: browserBundleID
        )

        var visitsByBundle: [String: [RawWebsiteVisitInterval]] = [:]
        for row in rows {
            let startTime: Date = row["startTime"]
            let endTime: Date = row["endTime"]
            guard let clipped = clippedInterval(start: startTime, end: endTime, to: dayBounds) else { continue }

            let domain: String = row["domain"]
            let fullURL: String? = row["fullURL"]
            let bundleID: String = row["browserBundleID"]
            let confidence = ActivityEvent.ConfidenceLevel(rawValue: row["confidence"]) ?? .low
            let source = ActivityEvent.EventSource(rawValue: row["source"]) ?? .browserHistory
            let clippedToForeground = clippedWebsiteVisit(
                interval: clipped,
                browserBundleID: bundleID,
                browserForegrounds: browserForegrounds
            )

            for effectiveInterval in clippedToForeground {
                visitsByBundle[bundleID, default: []].append(
                    RawWebsiteVisitInterval(
                        domain: domain,
                        bundleID: bundleID,
                        url: fullURL,
                        title: row["pageTitle"],
                        confidence: confidence,
                        source: source,
                        interval: effectiveInterval
                    )
                )
            }
        }

        let resolvedIntervals = visitsByBundle.values.flatMap(resolveEffectiveWebsiteIntervals)

        let summaries = Dictionary(grouping: resolvedIntervals, by: \.domain).compactMap { domain, visits -> WebsiteUsageSummary? in
            let merged = mergedIntervals(from: visits.map(\.interval))
            let totalDuration = merged.reduce(0.0) { $0 + $1.duration }
            guard totalDuration >= Constants.minimumWebsiteVisitDuration else { return nil }
            let rawVisitCount = visits.count

            let bundleIDs = Set(visits.map(\.bundleID))
            let browserName: String
            if bundleIDs.count == 1, let singleBundleID = bundleIDs.first {
                browserName = Constants.browserNames[singleBundleID] ?? "Browser"
            } else {
                browserName = "Multiple Browsers"
            }

            let topTitle = visits
                .sorted { $0.interval.duration > $1.interval.duration }
                .lazy
                .compactMap(\.title)
                .first(where: { !$0.isEmpty })

            let bestConfidence: ActivityEvent.ConfidenceLevel
            if visits.contains(where: { $0.source == .accessibility || $0.source == .browserExtension }) {
                bestConfidence = .high
            } else if visits.contains(where: { $0.source == .browserHistory }) {
                bestConfidence = .medium
            } else {
                bestConfidence = visits.map(\.confidence).max(by: confidenceRank) ?? .low
            }

            let browserBreakdowns = Dictionary(grouping: visits, by: \.bundleID)
                .compactMap { bundleID, browserVisits -> WebsiteBrowserBreakdown? in
                    let bundleMerged = mergedIntervals(from: browserVisits.map(\.interval))
                    let bundleTotal = bundleMerged.reduce(0.0) { $0 + $1.duration }
                    guard bundleTotal >= Constants.minimumWebsiteVisitDuration else { return nil }

                    let representativeTitle = browserVisits
                        .sorted { $0.interval.duration > $1.interval.duration }
                        .lazy
                        .compactMap(\.title)
                        .first(where: { !$0.isEmpty })

                    return WebsiteBrowserBreakdown(
                        browserBundleID: bundleID,
                        browserName: Constants.browserNames[bundleID] ?? "Browser",
                        totalDuration: bundleTotal,
                        representativePageTitle: representativeTitle,
                        activePageTitle: nil
                    )
                }
                .sorted { lhs, rhs in
                    if lhs.totalDuration == rhs.totalDuration {
                        return lhs.browserName.localizedCaseInsensitiveCompare(rhs.browserName) == .orderedAscending
                    }
                    return lhs.totalDuration > rhs.totalDuration
                }

            return WebsiteUsageSummary(
                domain: domain,
                totalDuration: totalDuration,
                visitCount: rawVisitCount,
                topPageTitle: topTitle,
                confidence: bestConfidence,
                browserName: browserName,
                browserBreakdowns: browserBreakdowns
            )
        }
        .sorted { lhs, rhs in
            if lhs.totalDuration == rhs.totalDuration {
                return lhs.domain.localizedCaseInsensitiveCompare(rhs.domain) == .orderedAscending
            }
            return lhs.totalDuration > rhs.totalDuration
        }

        if let limit {
            return Array(summaries.prefix(limit))
        }
        return summaries
    }

    func topPagesByDomain(
        in db: Database,
        dayBounds: DayBounds,
        domains: [String],
        limitPerDomain: Int
    ) throws -> [String: [WebsitePageSummary]] {
        guard !domains.isEmpty else { return [:] }

        let quotedDomains = domains
            .map { "'\($0.replacingOccurrences(of: "'", with: "''"))'" }
            .joined(separator: ", ")

        let rows = try Row.fetchAll(db, sql: """
            SELECT domain, fullURL, browserBundleID, confidence, source, pageTitle, startTime, endTime
            FROM website_visits
            WHERE startTime < ? AND endTime > ?
              AND domain IN (\(quotedDomains))
            ORDER BY domain ASC, startTime ASC
            """, arguments: [dayBounds.end, dayBounds.start])

        let browserForegrounds = try foregroundBrowserIntervals(
            in: db,
            dayBounds: dayBounds,
            browserBundleID: nil
        )

        var visitsByBundle: [String: [RawWebsiteVisitInterval]] = [:]
        for row in rows {
            let startTime: Date = row["startTime"]
            let endTime: Date = row["endTime"]
            guard let clipped = clippedInterval(start: startTime, end: endTime, to: dayBounds) else { continue }

            let bundleID: String = row["browserBundleID"]
            let confidence = ActivityEvent.ConfidenceLevel(rawValue: row["confidence"]) ?? .low
            let source = ActivityEvent.EventSource(rawValue: row["source"]) ?? .browserHistory
            let clippedToForeground = clippedWebsiteVisit(
                interval: clipped,
                browserBundleID: bundleID,
                browserForegrounds: browserForegrounds
            )

            for effectiveInterval in clippedToForeground {
                visitsByBundle[bundleID, default: []].append(
                    RawWebsiteVisitInterval(
                        domain: row["domain"],
                        bundleID: bundleID,
                        url: row["fullURL"],
                        title: row["pageTitle"],
                        confidence: confidence,
                        source: source,
                        interval: effectiveInterval
                    )
                )
            }
        }

        let resolvedIntervals = visitsByBundle.values.flatMap(resolveEffectiveWebsiteIntervals)

        return Dictionary(grouping: resolvedIntervals, by: \.domain).reduce(into: [:]) { result, entry in
            let (domain, visits) = entry
            let summaries = Dictionary(grouping: visits) { visit in
                visit.url ?? "https://\(visit.domain)"
            }
            .compactMap { url, pageVisits -> WebsitePageSummary? in
                let merged = mergedIntervals(from: pageVisits.map(\.interval))
                let totalDuration = merged.reduce(0.0) { $0 + $1.duration }
                guard totalDuration >= Constants.minimumWebsiteVisitDuration else { return nil }

                let title = pageVisits
                    .sorted { $0.interval.duration > $1.interval.duration }
                    .lazy
                    .compactMap(\.title)
                    .first(where: { !$0.isEmpty })

                return WebsitePageSummary(
                    domain: domain,
                    url: url,
                    title: title,
                    totalDuration: totalDuration
                )
            }
            .sorted { lhs, rhs in
                if lhs.totalDuration == rhs.totalDuration {
                    return lhs.url.localizedCaseInsensitiveCompare(rhs.url) == .orderedAscending
                }
                return lhs.totalDuration > rhs.totalDuration
            }

            result[domain] = Array(summaries.prefix(limitPerDomain))
        }
    }

    func foregroundBrowserIntervals(
        in db: Database,
        dayBounds: DayBounds,
        browserBundleID: String?
    ) throws -> [String: [ClippedInterval]] {
        let rows: [Row]
        if let browserBundleID {
            rows = try Row.fetchAll(db, sql: """
                SELECT browserBundleID, startTime, endTime
                FROM browser_sessions
                WHERE startTime < ? AND endTime > ? AND browserBundleID = ?
                ORDER BY startTime ASC
                """, arguments: [dayBounds.end, dayBounds.start, browserBundleID])
        } else {
            rows = try Row.fetchAll(db, sql: """
                SELECT browserBundleID, startTime, endTime
                FROM browser_sessions
                WHERE startTime < ? AND endTime > ?
                ORDER BY startTime ASC
                """, arguments: [dayBounds.end, dayBounds.start])
        }

        var intervalsByBundle: [String: [ClippedInterval]] = [:]
        for row in rows {
            let bundleID: String = row["browserBundleID"]
            let startTime: Date = row["startTime"]
            let endTime: Date = row["endTime"]
            guard let clipped = clippedInterval(start: startTime, end: endTime, to: dayBounds) else { continue }
            intervalsByBundle[bundleID, default: []].append(clipped)
        }

        return intervalsByBundle.mapValues {
            mergedIntervals(from: $0, maxGap: Constants.sessionMergeThreshold)
        }
    }

    func clippedWebsiteVisit(
        interval: ClippedInterval,
        browserBundleID: String,
        browserForegrounds: [String: [ClippedInterval]]
    ) -> [ClippedInterval] {
        guard let foregroundIntervals = browserForegrounds[browserBundleID], !foregroundIntervals.isEmpty else {
            return [interval]
        }
        return intersectedIntervals(interval, with: foregroundIntervals)
    }

    func resolveEffectiveWebsiteIntervals(_ visits: [RawWebsiteVisitInterval]) -> [EffectiveWebsiteInterval] {
        let sortedBoundaries = Array(
            Set(visits.flatMap { [$0.interval.start, $0.interval.end] })
        ).sorted()

        guard sortedBoundaries.count >= 2 else { return [] }

        var resolved: [EffectiveWebsiteInterval] = []
        for index in 0..<(sortedBoundaries.count - 1) {
            let segmentStart = sortedBoundaries[index]
            let segmentEnd = sortedBoundaries[index + 1]
            guard segmentEnd > segmentStart else { continue }

            let segment = ClippedInterval(start: segmentStart, end: segmentEnd)
            let covering = visits.filter {
                $0.interval.start < segment.end && $0.interval.end > segment.start
            }

            guard let bestVisit = covering.sorted(by: preferredVisit).first else { continue }

            let effective = EffectiveWebsiteInterval(
                domain: bestVisit.domain,
                bundleID: bestVisit.bundleID,
                url: bestVisit.url,
                title: bestVisit.title,
                confidence: bestVisit.confidence,
                source: bestVisit.source,
                interval: segment
            )

            if let last = resolved.last,
               last.domain == effective.domain,
               last.bundleID == effective.bundleID,
               last.url == effective.url,
               last.title == effective.title,
               last.source == effective.source,
               last.confidence == effective.confidence,
               last.interval.end == effective.interval.start {
                resolved[resolved.count - 1] = EffectiveWebsiteInterval(
                    domain: last.domain,
                    bundleID: last.bundleID,
                    url: last.url,
                    title: last.title ?? effective.title,
                    confidence: last.confidence,
                    source: last.source,
                    interval: ClippedInterval(start: last.interval.start, end: effective.interval.end)
                )
            } else {
                resolved.append(effective)
            }
        }

        return resolved
    }

    func preferredVisit(_ lhs: RawWebsiteVisitInterval, _ rhs: RawWebsiteVisitInterval) -> Bool {
        let lhsKey = (sourcePriority(lhs.source), confidencePriority(lhs.confidence), lhs.interval.start)
        let rhsKey = (sourcePriority(rhs.source), confidencePriority(rhs.confidence), rhs.interval.start)

        if lhsKey.0 != rhsKey.0 {
            return lhsKey.0 > rhsKey.0
        }
        if lhsKey.1 != rhsKey.1 {
            return lhsKey.1 > rhsKey.1
        }
        return lhsKey.2 > rhsKey.2
    }

    func sourcePriority(_ source: ActivityEvent.EventSource) -> Int {
        switch source {
        case .accessibility: 3
        case .browserExtension: 2
        case .browserHistory: 1
        case .nsworkspace, .idle: 0
        }
    }

    func confidencePriority(_ confidence: ActivityEvent.ConfidenceLevel) -> Int {
        switch confidence {
        case .high: 3
        case .medium: 2
        case .low: 1
        }
    }

    func confidenceRank(_ lhs: ActivityEvent.ConfidenceLevel, _ rhs: ActivityEvent.ConfidenceLevel) -> Bool {
        confidencePriority(lhs) < confidencePriority(rhs)
    }

    func mergeAdjacentAppSessions(_ sessions: [AppSession]) -> [AppSession] {
        let sorted = sessions.sorted { $0.startTime < $1.startTime }
        var merged: [AppSession] = []

        for session in sorted {
            guard let last = merged.last else {
                merged.append(session)
                continue
            }

            let isSameApp = last.bundleID == session.bundleID && last.appName == session.appName
            let gap = session.startTime.timeIntervalSince(last.endTime)

            // Meeting and communication apps get a longer merge window to capture time spent
            // briefly switching to check a message or browser during an active call.
            let mergeThreshold: TimeInterval = (last.category == .meetings || last.category == .communication)
                ? 300.0  // 5 minutes
                : Constants.sessionMergeThreshold

            guard isSameApp, gap <= mergeThreshold else {
                merged.append(session)
                continue
            }

            let mergedSession = AppSession(
                id: last.id,
                date: last.date,
                bundleID: last.bundleID,
                appName: last.appName,
                startTime: last.startTime,
                endTime: max(last.endTime, session.endTime),
                duration: max(last.endTime, session.endTime).timeIntervalSince(last.startTime),
                category: last.category,
                isBrowser: last.isBrowser
            )
            merged[merged.count - 1] = mergedSession
        }

        return merged
    }
}
