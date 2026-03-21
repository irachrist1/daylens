import Foundation
import GRDB

/// All data needed to render a single day's dashboard.
struct CombinedDayPayload {
    let appSummaries: [AppUsageSummary]
    let timeline: [AppSession]
    let websiteSummaries: [WebsiteUsageSummary]
    let browserSummaries: [BrowserUsageSummary]
    let dailySummary: DailySummary?
    let categoryOverrides: [String: AppCategory]
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

    // MARK: - App Sessions

    func appUsageSummaries(for date: Date) throws -> [AppUsageSummary] {
        try dbQueue.read { db in
            let overrides = (try? self.categoryOverrides(in: db)) ?? [:]
            return try self.appUsageSummaries(in: db, dayBounds: DayBounds(for: date), overrides: overrides)
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

    func appSessions(for date: Date, bundleID: String) throws -> [AppSession] {
        try dbQueue.read { db in
            try self.appSessions(in: db, dayBounds: DayBounds(for: date), bundleID: bundleID)
        }
    }

    /// Single-read payload for a day: calls meaningfulAppSessions once, shares result between
    /// appSummaries and timeline, and batches all queries into one dbQueue.read snapshot.
    func combinedDayPayload(for date: Date) throws -> CombinedDayPayload {
        try dbQueue.read { db in
            let dayBounds = DayBounds(for: date)
            let overrides = (try? categoryOverrides(in: db)) ?? [:]
            let sessions = try meaningfulAppSessions(in: db, dayBounds: dayBounds, overrides: overrides)
            let appSummaries = appUsageSummariesFromSessions(sessions, overrides: overrides)
            let websiteSummaries = try websiteUsageSummaries(in: db, dayBounds: dayBounds)
            let browserSummaries = try browserUsageSummaries(in: db, dayBounds: dayBounds)
            let dailySummary = try DailySummary.filter(Column("date") == dayBounds.start).fetchOne(db)
            return CombinedDayPayload(
                appSummaries: appSummaries,
                timeline: sessions,
                websiteSummaries: websiteSummaries,
                browserSummaries: browserSummaries,
                dailySummary: dailySummary,
                categoryOverrides: overrides
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
            let exclusion = MeaningfulActivityRules.sqlBundleIDExclusion

            // Aggregate totals per day
            let aggRows = try Row.fetchAll(db, sql: """
                SELECT date,
                       SUM(duration) AS totalDuration,
                       COUNT(DISTINCT bundleID) AS appCount
                FROM app_sessions
                WHERE bundleID NOT IN (\(exclusion))
                GROUP BY date
                HAVING totalDuration > 0
                ORDER BY date DESC
                LIMIT ?
                """, arguments: [limit])

            guard !aggRows.isEmpty else { return [] }

            // Scope top-app query to the same date window returned by the first query
            // so it doesn't perform a full-table scan on long-running installs.
            let minDate = aggRows.compactMap { $0["date"] as Date? }.min()
            let maxDate = aggRows.compactMap { $0["date"] as Date? }.max()

            // Top app per day (single pass — ORDER BY ensures highest first)
            let topRows: [Row]
            if let minDate, let maxDate {
                topRows = try Row.fetchAll(db, sql: """
                    SELECT date, bundleID, appName, SUM(duration) AS total
                    FROM app_sessions
                    WHERE bundleID NOT IN (\(exclusion))
                      AND date >= ? AND date <= ?
                    GROUP BY date, bundleID
                    ORDER BY date DESC, total DESC
                    """, arguments: [minDate, maxDate])
            } else {
                topRows = []
            }

            var topApps: [Date: (bundleID: String, appName: String)] = [:]
            for row in topRows {
                guard let date = row["date"] as Date?, topApps[date] == nil else { continue }
                topApps[date] = (row["bundleID"] as String, row["appName"] as String)
            }

            return aggRows.compactMap { row -> DaySummarySnapshot? in
                guard let date = row["date"] as Date? else { return nil }
                let totalDuration: Double = row["totalDuration"] ?? 0
                let appCount: Int = row["appCount"] ?? 0
                let top = topApps[date]
                return DaySummarySnapshot(
                    date: date,
                    totalActiveTime: totalDuration,
                    appCount: appCount,
                    topAppName: top?.appName,
                    topAppBundleID: top?.bundleID
                )
            }
        }
    }

    func aiContextPayload(for date: Date) throws -> AIDayContextPayload {
        try dbQueue.read { db in
            let dayBounds = DayBounds(for: date)
            let overrides = (try? categoryOverrides(in: db)) ?? [:]
            return AIDayContextPayload(
                date: dayBounds.start,
                appSummaries: try self.appUsageSummaries(in: db, dayBounds: dayBounds, overrides: overrides),
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
                        appSummaries: self.appUsageSummaries(in: db, dayBounds: dayBounds, overrides: overrides),
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
    let title: String?
    let confidence: ActivityEvent.ConfidenceLevel
    let source: ActivityEvent.EventSource
    let interval: ClippedInterval
}

private struct EffectiveWebsiteInterval {
    let domain: String
    let bundleID: String
    let title: String?
    let confidence: ActivityEvent.ConfidenceLevel
    let source: ActivityEvent.EventSource
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
        duration: TimeInterval
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

        if category == .system && duration < 30 {
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
        let dayBounds = DayBounds(for: date)
        let overrides = (try? categoryOverrides(in: db)) ?? [:]
        let summaries = try self.appUsageSummaries(in: db, dayBounds: dayBounds, overrides: overrides)
        let totalDuration = summaries.reduce(0) { $0 + $1.totalDuration }
        let topAppName = summaries.first?.appName
        let topAppBundleID = summaries.first?.bundleID

        return DaySummarySnapshot(
            date: dayBounds.start,
            totalActiveTime: totalDuration,
            appCount: summaries.count,
            topAppName: topAppName,
            topAppBundleID: topAppBundleID
        )
    }

    func computedDailySummary(
        in db: Database,
        dayBounds: DayBounds,
        aiSummary: String?,
        aiSummaryGeneratedAt: Date?
    ) throws -> DailySummary {
        let overrides = (try? categoryOverrides(in: db)) ?? [:]
        let appSummaries = try appUsageSummaries(in: db, dayBounds: dayBounds, overrides: overrides)
        let websiteSummaries = try websiteUsageSummaries(in: db, dayBounds: dayBounds)
        let timeline = try meaningfulAppSessions(in: db, dayBounds: dayBounds, overrides: overrides)

        let totalActiveTime = appSummaries.reduce(0) { $0 + $1.totalDuration }
        let contextSwitches = max(0, timeline.count - 1)

        return DailySummary(
            date: dayBounds.start,
            totalActiveTime: totalActiveTime,
            totalIdleTime: 0,
            appCount: appSummaries.count,
            browserCount: try browserCount(in: db, dayBounds: dayBounds),
            domainCount: websiteSummaries.count,
            sessionCount: timeline.count,
            contextSwitches: contextSwitches,
            focusScore: computeFocusScore(for: timeline, totalTime: totalActiveTime),
            longestFocusStreak: computeLongestFocusStreak(for: timeline),
            topAppBundleID: appSummaries.first?.bundleID,
            topDomain: websiteSummaries.first?.domain,
            aiSummary: aiSummary,
            aiSummaryGeneratedAt: aiSummaryGeneratedAt
        )
    }

    func meaningfulAppSessions(in db: Database, dayBounds: DayBounds, overrides: [String: AppCategory] = [:]) throws -> [AppSession] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT id, date, bundleID, appName, startTime, endTime, duration, category, isBrowser
            FROM app_sessions
            WHERE startTime < ? AND endTime > ?
            ORDER BY startTime ASC
            """, arguments: [dayBounds.end, dayBounds.start])

        let clippedSessions = rows.compactMap { row -> AppSession? in
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
                duration: clipped.duration
            ) else {
                return nil
            }

            return AppSession(
                id: row["id"],
                date: dayBounds.start,
                bundleID: bundleID,
                appName: appName,
                startTime: clipped.start,
                endTime: clipped.end,
                duration: clipped.duration,
                category: category,
                isBrowser: row["isBrowser"]
            )
        }

        return mergeAdjacentAppSessions(clippedSessions)
    }

    func timelineEvents(in db: Database, dayBounds: DayBounds) throws -> [AppSession] {
        try meaningfulAppSessions(in: db, dayBounds: dayBounds)
    }

    func appSessions(in db: Database, dayBounds: DayBounds, bundleID: String) throws -> [AppSession] {
        try meaningfulAppSessions(in: db, dayBounds: dayBounds)
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

    func computeFocusScore(for sessions: [AppSession], totalTime: TimeInterval) -> Double {
        guard totalTime > 0 else { return 0 }

        let focusedTime = sessions
            .filter { $0.category.isFocused }
            .reduce(0.0) { $0 + $1.duration }

        let focusRatio = focusedTime / totalTime
        // Light penalty for rapid context switching — but AI-assisted dev patterns
        // (many short terminal/browser/AI switches) should not heavily penalise genuinely
        // focused work. Cap at 15% so a coding-heavy day still scores 60–80%+.
        let switchRate = Double(sessions.count) / max(totalTime / 3600.0, 0.1)
        let switchPenalty = min(switchRate / 300.0, 0.15)

        return min(1.0, focusRatio * (1.0 - switchPenalty))
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

    func appUsageSummaries(in db: Database, dayBounds: DayBounds, overrides: [String: AppCategory] = [:]) throws -> [AppUsageSummary] {
        let sessions = try meaningfulAppSessions(in: db, dayBounds: dayBounds, overrides: overrides)
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

    func websiteUsageSummaries(
        in db: Database,
        dayBounds: DayBounds,
        browserBundleID: String? = nil,
        limit: Int? = nil
    ) throws -> [WebsiteUsageSummary] {
        let rows: [Row]
        if let browserBundleID {
            rows = try Row.fetchAll(db, sql: """
                SELECT domain, browserBundleID, confidence, source, pageTitle, startTime, endTime
                FROM website_visits
                WHERE startTime < ? AND endTime > ? AND browserBundleID = ?
                ORDER BY domain ASC, startTime ASC
                """, arguments: [dayBounds.end, dayBounds.start, browserBundleID])
        } else {
            rows = try Row.fetchAll(db, sql: """
                SELECT domain, browserBundleID, confidence, source, pageTitle, startTime, endTime
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

            return WebsiteUsageSummary(
                domain: domain,
                totalDuration: totalDuration,
                visitCount: rawVisitCount,
                topPageTitle: topTitle,
                confidence: bestConfidence,
                browserName: browserName
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
                title: bestVisit.title,
                confidence: bestVisit.confidence,
                source: bestVisit.source,
                interval: segment
            )

            if let last = resolved.last,
               last.domain == effective.domain,
               last.bundleID == effective.bundleID,
               last.source == effective.source,
               last.confidence == effective.confidence,
               last.interval.end == effective.interval.start {
                resolved[resolved.count - 1] = EffectiveWebsiteInterval(
                    domain: last.domain,
                    bundleID: last.bundleID,
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
