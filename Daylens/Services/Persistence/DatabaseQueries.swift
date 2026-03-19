import Foundation
import GRDB

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

    func saveDailySummary(_ summary: DailySummary) throws {
        try dbQueue.write { db in
            try summary.save(db, onConflict: .replace)
        }
    }

    // MARK: - App Sessions

    func appUsageSummaries(for date: Date) throws -> [AppUsageSummary] {
        try dbQueue.read { db in
            try self.appUsageSummaries(in: db, dayBounds: DayBounds(for: date))
        }
    }

    // MARK: - Browser Sessions

    func browserUsageSummaries(for date: Date) throws -> [BrowserUsageSummary] {
        try dbQueue.read { db in
            let dayBounds = DayBounds(for: date)
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
                        topDomains: (try? self.topDomains(in: db, dayBounds: dayBounds, browserBundleID: summary.browserBundleID, limit: 3)) ?? []
                    )
                }
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
            let dayBounds = DayBounds(for: date)
            let rows = try Row.fetchAll(db, sql: """
                SELECT id, date, bundleID, appName, startTime, endTime, duration, isBrowser
                FROM app_sessions
                WHERE startTime < ? AND endTime > ?
                ORDER BY startTime ASC
                """, arguments: [dayBounds.end, dayBounds.start])

            return rows.compactMap { row in
                let bundleID: String = row["bundleID"]
                let appName: String = row["appName"]
                let startTime: Date = row["startTime"]
                let endTime: Date = row["endTime"]
                guard let clipped = clippedInterval(start: startTime, end: endTime, to: dayBounds) else {
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
                    category: AppCategory.categorize(bundleID: bundleID, appName: appName),
                    isBrowser: row["isBrowser"]
                )
            }
        }
    }

    // MARK: - AI Summary Persistence

    /// Persist an AI-generated summary for a specific day.
    /// Uses raw SQL upsert to guarantee the write succeeds regardless of
    /// whether a DailySummary row already exists.
    func saveAISummary(_ text: String, for date: Date) throws {
        let dayStart = Calendar.current.startOfDay(for: date)
        try dbQueue.write { db in
            // Try updating an existing row first
            try db.execute(
                sql: "UPDATE daily_summaries SET aiSummary = ?, aiSummaryGeneratedAt = ? WHERE date = ?",
                arguments: [text, Date(), dayStart]
            )
            if db.changesCount == 0 {
                // No row for this date — insert a minimal one
                try db.execute(
                    sql: """
                        INSERT INTO daily_summaries
                            (date, totalActiveTime, totalIdleTime, appCount, browserCount,
                             domainCount, sessionCount, contextSwitches, focusScore,
                             longestFocusStreak, aiSummary, aiSummaryGeneratedAt)
                        VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)
                        """,
                    arguments: [dayStart, text, Date()]
                )
            }
        }
    }

    // MARK: - Tracked Days

    /// Returns dates that have at least one app session, most recent first.
    func trackedDays(limit: Int = 60) throws -> [Date] {
        try dbQueue.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT DISTINCT date FROM app_sessions
                ORDER BY date DESC
                LIMIT ?
                """, arguments: [limit])
            return rows.compactMap { $0["date"] as Date? }
        }
    }

    /// Lightweight summary for a single day, computed from app_sessions.
    func daySummarySnapshot(for date: Date) throws -> DaySummarySnapshot {
        try dbQueue.read { db in
            let dayBounds = DayBounds(for: date)
            let summaries = try self.appUsageSummaries(in: db, dayBounds: dayBounds)
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
        self.end = Calendar.current.date(byAdding: .day, value: 1, to: dayStart)!
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
    let confidence: String
    let interval: ClippedInterval
}

private func clippedInterval(start: Date, end: Date, to dayBounds: DayBounds) -> ClippedInterval? {
    let clippedStart = max(start, dayBounds.start)
    let clippedEnd = min(end, dayBounds.end)
    guard clippedEnd > clippedStart else { return nil }
    return ClippedInterval(start: clippedStart, end: clippedEnd)
}

private func mergedIntervals(from intervals: [ClippedInterval]) -> [ClippedInterval] {
    let sorted = intervals.sorted { $0.start < $1.start }
    var merged: [ClippedInterval] = []

    for interval in sorted {
        if let last = merged.last, interval.start <= last.end {
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

private extension AppDatabase {
    func appUsageSummaries(in db: Database, dayBounds: DayBounds) throws -> [AppUsageSummary] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT bundleID, appName, isBrowser, startTime, endTime
            FROM app_sessions
            WHERE startTime < ? AND endTime > ?
            ORDER BY startTime ASC
            """, arguments: [dayBounds.end, dayBounds.start])

        struct AppAccumulator {
            let bundleID: String
            let appName: String
            let isBrowser: Bool
            var totalDuration: TimeInterval
            var sessionCount: Int
        }

        var grouped: [String: AppAccumulator] = [:]
        for row in rows {
            let startTime: Date = row["startTime"]
            let endTime: Date = row["endTime"]
            guard let clipped = clippedInterval(start: startTime, end: endTime, to: dayBounds) else { continue }

            let bundleID: String = row["bundleID"]
            let appName: String = row["appName"]
            let isBrowser: Bool = row["isBrowser"]

            if grouped[bundleID] == nil {
                grouped[bundleID] = AppAccumulator(
                    bundleID: bundleID,
                    appName: appName,
                    isBrowser: isBrowser,
                    totalDuration: 0,
                    sessionCount: 0
                )
            }

            grouped[bundleID]?.totalDuration += clipped.duration
            grouped[bundleID]?.sessionCount += 1
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
                    category: AppCategory.categorize(bundleID: summary.bundleID, appName: summary.appName),
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
                SELECT domain, browserBundleID, confidence, pageTitle, startTime, endTime
                FROM website_visits
                WHERE startTime < ? AND endTime > ? AND browserBundleID = ?
                ORDER BY domain ASC, startTime ASC
                """, arguments: [dayBounds.end, dayBounds.start, browserBundleID])
        } else {
            rows = try Row.fetchAll(db, sql: """
                SELECT domain, browserBundleID, confidence, pageTitle, startTime, endTime
                FROM website_visits
                WHERE startTime < ? AND endTime > ?
                ORDER BY domain ASC, startTime ASC
                """, arguments: [dayBounds.end, dayBounds.start])
        }

        var domainVisits: [String: [RawWebsiteVisitInterval]] = [:]
        for row in rows {
            let startTime: Date = row["startTime"]
            let endTime: Date = row["endTime"]
            guard let clipped = clippedInterval(start: startTime, end: endTime, to: dayBounds) else { continue }

            let domain: String = row["domain"]
            domainVisits[domain, default: []].append(
                RawWebsiteVisitInterval(
                    domain: domain,
                    bundleID: row["browserBundleID"],
                    title: row["pageTitle"],
                    confidence: row["confidence"],
                    interval: clipped
                )
            )
        }

        let summaries = domainVisits.compactMap { domain, visits -> WebsiteUsageSummary? in
            let merged = mergedIntervals(from: visits.map(\.interval))
            let totalDuration = merged.reduce(0.0) { $0 + $1.duration }
            guard totalDuration >= Constants.minimumWebsiteVisitDuration else { return nil }

            let bundleIDs = Set(visits.map(\.bundleID))
            let browserName: String
            if bundleIDs.count == 1, let singleBundleID = bundleIDs.first {
                browserName = Constants.browserNames[singleBundleID] ?? "Browser"
            } else {
                browserName = "Multiple Browsers"
            }

            let topTitle = visits.lazy.compactMap(\.title).first(where: { !$0.isEmpty })
            let bestConfidence = visits.contains(where: { $0.confidence == ActivityEvent.ConfidenceLevel.high.rawValue })
                ? ActivityEvent.ConfidenceLevel.high
                : ActivityEvent.ConfidenceLevel(rawValue: visits.first?.confidence ?? ActivityEvent.ConfidenceLevel.low.rawValue) ?? .low

            return WebsiteUsageSummary(
                domain: domain,
                totalDuration: totalDuration,
                visitCount: merged.count,
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
}
