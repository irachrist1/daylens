import Foundation
#if canImport(GRDB)
import GRDB
#endif

/// Provides CRUD operations for all activity data.
/// Thread-safe via GRDB's DatabasePool and Swift actor isolation.
actor ActivityStore {
    #if canImport(GRDB)
    private let database: Database

    init(database: Database) {
        self.database = database
    }

    // MARK: - Apps

    func findOrCreateApp(bundleIdentifier: String, name: String) throws -> AppRecord {
        try database.write { db in
            if var existing = try AppRecord
                .filter(AppRecord.Columns.bundleIdentifier == bundleIdentifier)
                .fetchOne(db) {
                if existing.name != name {
                    existing.name = name
                    try existing.update(db)
                }
                return existing
            }

            var app = AppRecord(
                bundleIdentifier: bundleIdentifier,
                name: name,
                category: AppRecord.inferCategory(for: bundleIdentifier)
            )
            try app.insert(db)
            return app
        }
    }

    func fetchApp(id: UUID) throws -> AppRecord? {
        try database.read { db in
            try AppRecord.filter(AppRecord.Columns.id == id).fetchOne(db)
        }
    }

    func fetchAllApps() throws -> [AppRecord] {
        try database.read { db in
            try AppRecord.fetchAll(db)
        }
    }

    func updateAppCategory(_ appId: UUID, category: ActivityCategory) throws {
        try database.write { db in
            try db.execute(
                sql: "UPDATE apps SET category = ? WHERE id = ?",
                arguments: [category.rawValue, appId]
            )
        }
    }

    // MARK: - Browsers

    func findOrCreateBrowser(bundleIdentifier: String, name: String) throws -> BrowserRecord {
        try database.write { db in
            if let existing = try BrowserRecord
                .filter(BrowserRecord.Columns.bundleIdentifier == bundleIdentifier)
                .fetchOne(db) {
                return existing
            }

            var browser = BrowserRecord(
                bundleIdentifier: bundleIdentifier,
                name: name
            )
            try browser.insert(db)
            return browser
        }
    }

    func markExtensionInstalled(browserId: UUID, installed: Bool) throws {
        try database.write { db in
            try db.execute(
                sql: "UPDATE browsers SET extensionInstalled = ? WHERE id = ?",
                arguments: [installed, browserId]
            )
        }
    }

    func fetchAllBrowsers() throws -> [BrowserRecord] {
        try database.read { db in
            try BrowserRecord.fetchAll(db)
        }
    }

    // MARK: - Websites

    func findOrCreateWebsite(domain: String) throws -> WebsiteRecord {
        try database.write { db in
            let normalizedDomain = domain.lowercased()
            if let existing = try WebsiteRecord
                .filter(WebsiteRecord.Columns.domain == normalizedDomain)
                .fetchOne(db) {
                return existing
            }

            var website = WebsiteRecord(
                domain: normalizedDomain,
                category: WebsiteRecord.inferCategory(for: normalizedDomain)
            )
            try website.insert(db)
            return website
        }
    }

    func fetchAllWebsites() throws -> [WebsiteRecord] {
        try database.read { db in
            try WebsiteRecord.fetchAll(db)
        }
    }

    // MARK: - Activity Events

    func insertEvent(_ event: ActivityEvent) throws {
        try database.write { db in
            var mutableEvent = event
            try mutableEvent.insert(db)
        }
    }

    func insertEvents(_ events: [ActivityEvent]) throws {
        try database.write { db in
            for var event in events {
                try event.insert(db)
            }
        }
    }

    func fetchEvents(from: Date, to: Date) throws -> [ActivityEvent] {
        try database.read { db in
            try ActivityEvent
                .filter(ActivityEvent.Columns.timestamp >= from
                        && ActivityEvent.Columns.timestamp <= to)
                .order(ActivityEvent.Columns.timestamp)
                .fetchAll(db)
        }
    }

    func fetchEvents(forApp appId: UUID, from: Date, to: Date) throws -> [ActivityEvent] {
        try database.read { db in
            try ActivityEvent
                .filter(ActivityEvent.Columns.appId == appId
                        && ActivityEvent.Columns.timestamp >= from
                        && ActivityEvent.Columns.timestamp <= to)
                .order(ActivityEvent.Columns.timestamp)
                .fetchAll(db)
        }
    }

    func deleteEvents(olderThan date: Date) throws -> Int {
        try database.write { db in
            try ActivityEvent
                .filter(ActivityEvent.Columns.timestamp < date)
                .deleteAll(db)
        }
    }

    // MARK: - Sessions

    func insertSession(_ session: Session) throws {
        try database.write { db in
            var mutableSession = session
            try mutableSession.insert(db)
        }
    }

    func insertSessions(_ sessions: [Session]) throws {
        try database.write { db in
            for var session in sessions {
                try session.save(db)
            }
        }
    }

    func fetchSessions(from: Date, to: Date, significantOnly: Bool = false) throws -> [Session] {
        try database.read { db in
            var request = Session
                .filter(Session.Columns.startTime >= from
                        && Session.Columns.endTime <= to)
                .order(Session.Columns.startTime)

            if significantOnly {
                request = request.filter(Session.Columns.isSignificant == true)
            }

            return try request.fetchAll(db)
        }
    }

    func fetchSessions(forApp appId: UUID, from: Date, to: Date) throws -> [Session] {
        try database.read { db in
            try Session
                .filter(Session.Columns.appId == appId
                        && Session.Columns.startTime >= from
                        && Session.Columns.startTime <= to)
                .order(Session.Columns.startTime)
                .fetchAll(db)
        }
    }

    func fetchSessions(forWebsite websiteId: UUID, from: Date, to: Date) throws -> [Session] {
        try database.read { db in
            try Session
                .filter(Session.Columns.websiteId == websiteId
                        && Session.Columns.startTime >= from
                        && Session.Columns.startTime <= to)
                .order(Session.Columns.startTime)
                .fetchAll(db)
        }
    }

    func deleteSessions(olderThan date: Date) throws -> Int {
        try database.write { db in
            try Session
                .filter(Session.Columns.endTime < date)
                .deleteAll(db)
        }
    }

    // MARK: - Daily Summaries

    func upsertDailySummary(_ summary: DailySummary) throws {
        try database.write { db in
            if let existing = try DailySummary
                .filter(DailySummary.Columns.date == summary.date)
                .fetchOne(db) {
                var updated = summary
                updated.id = existing.id
                if updated.aiSummary == nil { updated.aiSummary = existing.aiSummary }
                if updated.generatedAt == nil { updated.generatedAt = existing.generatedAt }
                try updated.update(db)
            } else {
                var mutableSummary = summary
                try mutableSummary.insert(db)
            }
        }
    }

    func fetchDailySummary(for date: Date) throws -> DailySummary? {
        try database.read { db in
            try DailySummary
                .filter(DailySummary.Columns.date == date)
                .fetchOne(db)
        }
    }

    func fetchDailySummaries(from: Date, to: Date) throws -> [DailySummary] {
        try database.read { db in
            try DailySummary
                .filter(DailySummary.Columns.date >= from
                        && DailySummary.Columns.date <= to)
                .order(DailySummary.Columns.date.desc)
                .fetchAll(db)
        }
    }

    // MARK: - Insights

    func insertInsight(_ insight: Insight) throws {
        try database.write { db in
            var mutableInsight = insight
            try mutableInsight.insert(db)
        }
    }

    func fetchInsights(for summaryId: UUID) throws -> [Insight] {
        try database.read { db in
            try Insight
                .filter(Insight.Columns.dailySummaryId == summaryId)
                .order(Insight.Columns.createdAt.desc)
                .fetchAll(db)
        }
    }

    // MARK: - AI Conversations

    func createConversation(title: String? = nil) throws -> AIConversation {
        try database.write { db in
            var conversation = AIConversation(title: title)
            try conversation.insert(db)
            return conversation
        }
    }

    func insertMessage(_ message: AIMessage) throws {
        try database.write { db in
            var mutableMessage = message
            try mutableMessage.insert(db)

            try db.execute(
                sql: "UPDATE ai_conversations SET lastMessageAt = ? WHERE id = ?",
                arguments: [message.createdAt, message.conversationId]
            )
        }
    }

    func fetchMessages(for conversationId: UUID) throws -> [AIMessage] {
        try database.read { db in
            try AIMessage
                .filter(AIMessage.Columns.conversationId == conversationId)
                .order(AIMessage.Columns.createdAt)
                .fetchAll(db)
        }
    }

    func fetchRecentConversations(limit: Int = 20) throws -> [AIConversation] {
        try database.read { db in
            try AIConversation
                .order(AIConversation.Columns.lastMessageAt.desc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    // MARK: - Aggregations

    func appDurations(from: Date, to: Date) throws -> [(appId: UUID, name: String, duration: TimeInterval, category: ActivityCategory)] {
        try database.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT s.appId, a.name, SUM(s.duration) as totalDuration, a.category
                FROM sessions s
                JOIN apps a ON s.appId = a.id
                WHERE s.startTime >= ? AND s.startTime <= ? AND s.duration > 0
                GROUP BY s.appId
                ORDER BY totalDuration DESC
                """, arguments: [from, to])

            return rows.compactMap { row -> (appId: UUID, name: String, duration: TimeInterval, category: ActivityCategory)? in
                guard let id: UUID = row["appId"],
                      let name: String = row["name"],
                      let duration: Double = row["totalDuration"] else { return nil }
                let catStr: String? = row["category"]
                let category = catStr.flatMap { ActivityCategory(rawValue: $0) } ?? .uncategorized
                return (appId: id, name: name, duration: duration, category: category)
            }
        }
    }

    func websiteDurations(from: Date, to: Date) throws -> [(websiteId: UUID, domain: String, duration: TimeInterval, category: ActivityCategory)] {
        try database.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT s.websiteId, w.domain, SUM(s.duration) as totalDuration, w.category
                FROM sessions s
                JOIN websites w ON s.websiteId = w.id
                WHERE s.startTime >= ? AND s.startTime <= ?
                    AND s.websiteId IS NOT NULL AND s.duration > 0
                GROUP BY s.websiteId
                ORDER BY totalDuration DESC
                """, arguments: [from, to])

            return rows.compactMap { row -> (websiteId: UUID, domain: String, duration: TimeInterval, category: ActivityCategory)? in
                guard let id: UUID = row["websiteId"],
                      let domain: String = row["domain"],
                      let duration: Double = row["totalDuration"] else { return nil }
                let catStr: String? = row["category"]
                let category = catStr.flatMap { ActivityCategory(rawValue: $0) } ?? .uncategorized
                return (websiteId: id, domain: domain, duration: duration, category: category)
            }
        }
    }

    func browserDurations(from: Date, to: Date) throws -> [(browserId: UUID, name: String, duration: TimeInterval)] {
        try database.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT s.browserId, b.name, SUM(s.duration) as totalDuration
                FROM sessions s
                JOIN browsers b ON s.browserId = b.id
                WHERE s.startTime >= ? AND s.startTime <= ?
                    AND s.browserId IS NOT NULL AND s.duration > 0
                GROUP BY s.browserId
                ORDER BY totalDuration DESC
                """, arguments: [from, to])

            return rows.compactMap { row -> (browserId: UUID, name: String, duration: TimeInterval)? in
                guard let id: UUID = row["browserId"],
                      let name: String = row["name"],
                      let duration: Double = row["totalDuration"] else { return nil }
                return (browserId: id, name: name, duration: duration)
            }
        }
    }

    func switchCount(from: Date, to: Date) throws -> Int {
        try database.read { db in
            let count = try Int.fetchOne(db, sql: """
                SELECT COUNT(*) FROM activity_events
                WHERE eventType = 'appActivated'
                    AND timestamp >= ? AND timestamp <= ?
                """, arguments: [from, to])
            return count ?? 0
        }
    }

    // MARK: - Data Management

    func pruneOldData(retentionDays: Int) throws {
        let cutoff = Calendar.current.date(byAdding: .day, value: -retentionDays, to: Date())!
        _ = try deleteEvents(olderThan: cutoff)
        _ = try deleteSessions(olderThan: cutoff)
    }

    func exportAllData() throws -> ExportData {
        try database.read { db in
            ExportData(
                apps: try AppRecord.fetchAll(db),
                browsers: try BrowserRecord.fetchAll(db),
                websites: try WebsiteRecord.fetchAll(db),
                sessions: try Session.fetchAll(db),
                dailySummaries: try DailySummary.fetchAll(db),
                insights: try Insight.fetchAll(db),
                exportedAt: Date()
            )
        }
    }

    func deleteAllData() throws {
        try database.write { db in
            try db.execute(sql: "DELETE FROM ai_messages")
            try db.execute(sql: "DELETE FROM ai_conversations")
            try db.execute(sql: "DELETE FROM insights")
            try db.execute(sql: "DELETE FROM daily_summaries")
            try db.execute(sql: "DELETE FROM sessions")
            try db.execute(sql: "DELETE FROM activity_events")
            try db.execute(sql: "DELETE FROM websites")
            try db.execute(sql: "DELETE FROM browsers")
            try db.execute(sql: "DELETE FROM apps")
        }
    }
    #endif
}

struct ExportData: Codable {
    let apps: [AppRecord]
    let browsers: [BrowserRecord]
    let websites: [WebsiteRecord]
    let sessions: [Session]
    let dailySummaries: [DailySummary]
    let insights: [Insight]
    let exportedAt: Date
}
