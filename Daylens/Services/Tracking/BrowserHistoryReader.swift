import Foundation
import GRDB
import OSLog

/// Reads browser history from local SQLite database files.
/// This is the primary native browser tracking approach — no extensions needed.
final class BrowserHistoryReader {
    private let logger = Logger(subsystem: "com.daylens.app", category: "BrowserHistory")
    private let database: AppDatabase
    private var timer: Timer?
    private var lastReadTimestamps: [String: Date] = [:]

    // UserDefaults key prefix for persisted browser read timestamps.
    private static let timestampKeyPrefix = "daylens_browser_last_read_"

    private func loadPersistedTimestamp(for bundleID: String) -> Date? {
        let key = Self.timestampKeyPrefix + bundleID
        let ts = UserDefaults.standard.double(forKey: key)
        guard ts > 0 else { return nil }
        return Date(timeIntervalSince1970: ts)
    }

    private func persistTimestamp(_ date: Date, for bundleID: String) {
        let key = Self.timestampKeyPrefix + bundleID
        let existing = UserDefaults.standard.double(forKey: key)
        if date.timeIntervalSince1970 > existing {
            UserDefaults.standard.set(date.timeIntervalSince1970, forKey: key)
        }
    }

    init(database: AppDatabase) {
        self.database = database
    }

    deinit {
        stopPolling()
    }

    func startPolling() {
        guard timer == nil else { return }

        // Restore persisted timestamps so we don't re-read already-processed history on relaunch.
        for definition in BrowserDefinition.all {
            if lastReadTimestamps[definition.bundleID] == nil,
               let persisted = loadPersistedTimestamp(for: definition.bundleID) {
                lastReadTimestamps[definition.bundleID] = persisted
            }
        }

        // Initial read
        Task { await readAllBrowserHistories() }

        // Poll periodically
        timer = Timer.scheduledTimer(withTimeInterval: Constants.browserHistoryPollInterval, repeats: true) { [weak self] _ in
            Task { await self?.readAllBrowserHistories() }
        }
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    private func readAllBrowserHistories() async {
        let homeDir = FileManager.default.homeDirectoryForCurrentUser.path

        for definition in BrowserDefinition.all {
            switch definition.engine {
            case .firefox:
                await readFirefoxFamilyHistory(
                    bundleID: definition.bundleID,
                    profilesDir: (homeDir as NSString).appendingPathComponent(definition.historyRelativePath)
                )
            case .safari:
                let path = (homeDir as NSString).appendingPathComponent(definition.historyRelativePath)
                if FileManager.default.fileExists(atPath: path) {
                    await readBrowserHistory(at: path, browserBundleID: definition.bundleID)
                }
            case .chromium:
                let primaryPath = (homeDir as NSString).appendingPathComponent(definition.historyRelativePath)
                if FileManager.default.fileExists(atPath: primaryPath) {
                    await readBrowserHistory(at: primaryPath, browserBundleID: definition.bundleID)
                } else {
                    await readChromiumProfiles(
                        bundleID: definition.bundleID,
                        relativePath: definition.historyRelativePath,
                        homeDir: homeDir
                    )
                }
            }
        }
    }

    /// Scans all profiles in a Chromium User Data directory for History files.
    private func readChromiumProfiles(bundleID: String, relativePath: String, homeDir: String) async {
        // Derive the User Data directory from the relative path (strip "/Default/History")
        let components = relativePath.components(separatedBy: "/")
        guard components.count >= 3 else { return }
        let userDataRelative = components.dropLast(2).joined(separator: "/")
        let userDataPath = (homeDir as NSString).appendingPathComponent(userDataRelative)

        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: userDataPath) else { return }

        for entry in entries where entry.hasPrefix("Profile") || entry == "Default" {
            let historyPath = (userDataPath as NSString).appendingPathComponent("\(entry)/History")
            if FileManager.default.fileExists(atPath: historyPath) {
                await readBrowserHistory(at: historyPath, browserBundleID: bundleID)
            }
        }
    }

    // MARK: - Chrome/Chromium-based browsers

    private func readBrowserHistory(at path: String, browserBundleID: String) async {
        guard FileManager.default.fileExists(atPath: path) else { return }

        // Chrome locks the database while running — copy to a temp file
        let tempPath = (NSTemporaryDirectory() as NSString).appendingPathComponent(
            "daylens_\(browserBundleID.replacingOccurrences(of: ".", with: "_"))_\(UUID().uuidString)_history.sqlite"
        )
        do {
            if FileManager.default.fileExists(atPath: tempPath) {
                try FileManager.default.removeItem(atPath: tempPath)
            }
            try FileManager.default.copyItem(atPath: path, toPath: tempPath)

            // Copy WAL and SHM sidecars if they exist (newest rows live here)
            for suffix in ["-wal", "-shm"] {
                let sidecar = path + suffix
                let tempSidecar = tempPath + suffix
                if FileManager.default.fileExists(atPath: sidecar) {
                    try? FileManager.default.copyItem(atPath: sidecar, toPath: tempSidecar)
                }
            }
        } catch {
            return // Can't copy, browser might have exclusive lock
        }
        defer {
            try? FileManager.default.removeItem(atPath: tempPath)
            try? FileManager.default.removeItem(atPath: tempPath + "-wal")
            try? FileManager.default.removeItem(atPath: tempPath + "-shm")
        }

        let isSafari = browserBundleID == "com.apple.Safari"

        do {
            let dbQueue = try DatabaseQueue(path: tempPath)

            if isSafari {
                try await readSafariHistory(from: dbQueue, browserBundleID: browserBundleID)
            } else {
                try await readChromiumHistory(from: dbQueue, browserBundleID: browserBundleID)
            }
        } catch {
            // Database might be corrupted or incompatible format
            logger.error("Failed to read browser history for \(browserBundleID, privacy: .public): \(error.localizedDescription, privacy: .private)")
        }
    }

    private func readChromiumHistory(from dbQueue: DatabaseQueue, browserBundleID: String) async throws {
        let lastRead = lastReadTimestamps[browserBundleID] ?? Calendar.current.startOfDay(for: Date())

        // Chrome stores time as microseconds since Jan 1, 1601
        let chromiumEpochOffset: Int64 = 11_644_473_600_000_000 // microseconds from 1601 to 1970
        let lastReadChromium = Int64(lastRead.timeIntervalSince1970 * 1_000_000) + chromiumEpochOffset

        var cursorTimeMicros = lastReadChromium
        var cursorVisitID: Int64 = 0
        var allVisits: [ChromiumHistoryVisit] = []

        while true {
            let batchCursorTimeMicros = cursorTimeMicros
            let batchCursorVisitID = cursorVisitID
            let batch = try await dbQueue.read { db -> [ChromiumHistoryVisit] in
                let rows = try Row.fetchAll(db, sql: """
                    SELECT v.id, u.url, u.title, v.visit_time, v.visit_duration
                    FROM visits v
                    JOIN urls u ON v.url = u.id
                    WHERE v.visit_time > ?
                       OR (v.visit_time = ? AND v.id > ?)
                    ORDER BY v.visit_time ASC, v.id ASC
                    LIMIT 500
                    """, arguments: [batchCursorTimeMicros, batchCursorTimeMicros, batchCursorVisitID])

                return rows.compactMap { row in
                    let visitTimeMicros: Int64 = row["visit_time"]
                    let epochMicros = visitTimeMicros - chromiumEpochOffset
                    let visitDate = Date(timeIntervalSince1970: TimeInterval(epochMicros) / 1_000_000.0)
                    let durationMicros: Int64 = row["visit_duration"] ?? 0

                    return ChromiumHistoryVisit(
                        visitID: row["id"],
                        url: row["url"],
                        title: (row["title"] as String?) ?? "",
                        visitTime: visitDate,
                        visitTimeMicros: visitTimeMicros,
                        recordedDuration: TimeInterval(durationMicros) / 1_000_000.0
                    )
                }
            }

            allVisits.append(contentsOf: batch)

            guard batch.count == 500, let lastVisit = batch.last else { break }
            cursorTimeMicros = lastVisit.visitTimeMicros
            cursorVisitID = lastVisit.visitID
        }

        guard !allVisits.isEmpty else { return }

        let foregroundIntervals = try browserForegroundIntervals(
            for: browserBundleID,
            from: allVisits.first?.visitTime ?? lastRead,
            to: (allVisits.last?.visitTime ?? lastRead).addingTimeInterval(30 * 60)
        )
        let visits = Self.estimateChromiumVisits(allVisits, foregroundIntervals: foregroundIntervals)

        for visit in visits {
            guard let domain = extractDomain(from: visit.url) else { continue }

            let websiteVisit = WebsiteVisit(
                date: Calendar.current.startOfDay(for: visit.visitTime),
                domain: domain,
                fullURL: visit.url,
                pageTitle: visit.title.isEmpty ? nil : visit.title,
                browserBundleID: browserBundleID,
                startTime: visit.visitTime,
                endTime: visit.visitTime.addingTimeInterval(visit.visitDuration),
                duration: visit.visitDuration,
                confidence: .high,
                source: .browserHistory
            )
            try? database.insertWebsiteVisit(websiteVisit)
        }

        if let lastVisit = allVisits.last {
            lastReadTimestamps[browserBundleID] = lastVisit.visitTime
            persistTimestamp(lastVisit.visitTime, for: browserBundleID)
        }
    }

    private func readSafariHistory(from dbQueue: DatabaseQueue, browserBundleID: String) async throws {
        let lastRead = lastReadTimestamps[browserBundleID] ?? Calendar.current.startOfDay(for: Date())

        // Safari stores time as seconds since Jan 1, 2001 (Mac absolute time / Core Data epoch)
        let macEpochOffset: TimeInterval = 978_307_200 // seconds from 1970 to 2001
        let lastReadMac = lastRead.timeIntervalSince1970 - macEpochOffset

        let visits = try await dbQueue.read { db -> [(url: String, title: String?, visitTime: Date)] in
            let rows = try Row.fetchAll(db, sql: """
                SELECT hi.url, hi.domain_expansion, hv.visit_time
                FROM history_visits hv
                JOIN history_items hi ON hv.history_item = hi.id
                WHERE hv.visit_time > ?
                ORDER BY hv.visit_time ASC
                LIMIT 500
                """, arguments: [lastReadMac])

            return rows.compactMap { row in
                let visitTimeMac: Double = row["visit_time"]
                let visitDate = Date(timeIntervalSince1970: visitTimeMac + macEpochOffset)
                return (
                    url: row["url"] as String,
                    title: row["domain_expansion"] as String?,
                    visitTime: visitDate
                )
            }
        }

        for visit in visits {
            guard let domain = extractDomain(from: visit.url) else { continue }

            let websiteVisit = WebsiteVisit(
                date: Calendar.current.startOfDay(for: visit.visitTime),
                domain: domain,
                fullURL: visit.url,
                pageTitle: visit.title,
                browserBundleID: browserBundleID,
                startTime: visit.visitTime,
                endTime: visit.visitTime.addingTimeInterval(Constants.minimumWebsiteVisitDuration),
                duration: Constants.minimumWebsiteVisitDuration,
                confidence: .high,
                source: .browserHistory
            )
            try? database.insertWebsiteVisit(websiteVisit)
        }

        if let lastVisit = visits.last {
            lastReadTimestamps[browserBundleID] = lastVisit.visitTime
            persistTimestamp(lastVisit.visitTime, for: browserBundleID)
        }
    }

    // MARK: - Firefox-family (Firefox, Zen)

    /// Reads history from any Firefox/Gecko-based browser by scanning its Profiles directory.
    private func readFirefoxFamilyHistory(bundleID: String, profilesDir: String) async {
        guard let profiles = try? FileManager.default.contentsOfDirectory(atPath: profilesDir) else { return }

        // Find the default profile (usually contains "default" in its name)
        for profile in profiles where profile.lowercased().contains("default") {
            let historyPath = (profilesDir as NSString).appendingPathComponent(profile + "/places.sqlite")
            guard FileManager.default.fileExists(atPath: historyPath) else { continue }

            let safeBundleID = bundleID.replacingOccurrences(of: ".", with: "_")
            let tempPath = (NSTemporaryDirectory() as NSString).appendingPathComponent(
                "daylens_\(safeBundleID)_\(UUID().uuidString)_places.sqlite"
            )
            do {
                if FileManager.default.fileExists(atPath: tempPath) {
                    try FileManager.default.removeItem(atPath: tempPath)
                }
                try FileManager.default.copyItem(atPath: historyPath, toPath: tempPath)
            } catch { continue }
            defer { try? FileManager.default.removeItem(atPath: tempPath) }

            let lastRead = lastReadTimestamps[bundleID] ?? Calendar.current.startOfDay(for: Date())
            let lastReadMicros = Int64(lastRead.timeIntervalSince1970 * 1_000_000)

            do {
                let dbQueue = try DatabaseQueue(path: tempPath)
                let visits = try await dbQueue.read { db -> [(url: String, title: String?, visitTime: Date)] in
                    let rows = try Row.fetchAll(db, sql: """
                        SELECT p.url, p.title, v.visit_date
                        FROM moz_historyvisits v
                        JOIN moz_places p ON v.place_id = p.id
                        WHERE v.visit_date > ?
                        ORDER BY v.visit_date ASC
                        LIMIT 500
                        """, arguments: [lastReadMicros])

                    return rows.compactMap { row in
                        let visitMicros: Int64 = row["visit_date"]
                        let visitDate = Date(timeIntervalSince1970: TimeInterval(visitMicros) / 1_000_000.0)
                        return (
                            url: row["url"] as String,
                            title: row["title"] as String?,
                            visitTime: visitDate
                        )
                    }
                }

                for visit in visits {
                    guard let domain = extractDomain(from: visit.url) else { continue }
                    let websiteVisit = WebsiteVisit(
                        date: Calendar.current.startOfDay(for: visit.visitTime),
                        domain: domain,
                        fullURL: visit.url,
                        pageTitle: visit.title,
                        browserBundleID: bundleID,
                        startTime: visit.visitTime,
                        endTime: visit.visitTime.addingTimeInterval(Constants.minimumWebsiteVisitDuration),
                        duration: Constants.minimumWebsiteVisitDuration,
                        confidence: .high,
                        source: .browserHistory
                    )
                    try? database.insertWebsiteVisit(websiteVisit)
                }

                if let lastVisit = visits.last {
                    lastReadTimestamps[bundleID] = lastVisit.visitTime
                    persistTimestamp(lastVisit.visitTime, for: bundleID)
                }
            } catch {
                logger.error("Failed to read \(bundleID, privacy: .public) history: \(error.localizedDescription, privacy: .private)")
            }
            break // Only read one profile
        }
    }

    // MARK: - Helpers

    static func normalizedDomain(from urlString: String) -> String? {
        guard let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let host = url.host else { return nil }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    private func extractDomain(from urlString: String) -> String? {
        Self.normalizedDomain(from: urlString)
    }

    private func browserForegroundIntervals(for browserBundleID: String, from start: Date, to end: Date) throws -> [BrowserForegroundInterval] {
        guard end > start else { return [] }

        let intervals = try database.dbQueue.read { db -> [BrowserForegroundInterval] in
            let rows = try Row.fetchAll(db, sql: """
                SELECT startTime, endTime
                FROM browser_sessions
                WHERE browserBundleID = ?
                  AND startTime < ?
                  AND endTime > ?
                ORDER BY startTime ASC
                """, arguments: [browserBundleID, end, start])

            return rows.compactMap { row in
                let startTime: Date = row["startTime"]
                let endTime: Date = row["endTime"]
                guard endTime > startTime else { return nil }
                return BrowserForegroundInterval(start: startTime, end: endTime)
            }
        }

        return Self.mergeForegroundIntervals(intervals)
    }

    static func estimateChromiumVisits(
        _ visits: [ChromiumHistoryVisit],
        foregroundIntervals: [BrowserForegroundInterval]
    ) -> [EstimatedChromiumVisit] {
        guard !visits.isEmpty else { return [] }

        return visits.enumerated().map { index, visit in
            let estimatedDuration: TimeInterval
            if let nextVisit = visits[safe: index + 1] {
                var gapDuration = nextVisit.visitTime.timeIntervalSince(visit.visitTime)
                gapDuration = min(gapDuration, 30 * 60)

                if let foreground = foregroundIntervals.first(where: { $0.contains(visit.visitTime) }) {
                    gapDuration = min(gapDuration, foreground.end.timeIntervalSince(visit.visitTime))
                }

                if visit.recordedDuration > 0, visit.recordedDuration < gapDuration {
                    gapDuration = visit.recordedDuration
                }

                estimatedDuration = gapDuration
            } else {
                var lastDuration = visit.recordedDuration > 0 ? visit.recordedDuration : Constants.minimumWebsiteVisitDuration
                if let foreground = foregroundIntervals.first(where: { $0.contains(visit.visitTime) }) {
                    lastDuration = min(lastDuration, foreground.end.timeIntervalSince(visit.visitTime))
                }
                estimatedDuration = lastDuration
            }

            return EstimatedChromiumVisit(
                url: visit.url,
                title: visit.title,
                visitTime: visit.visitTime,
                visitDuration: max(estimatedDuration, Constants.minimumWebsiteVisitDuration)
            )
        }
    }

    private static func mergeForegroundIntervals(_ intervals: [BrowserForegroundInterval]) -> [BrowserForegroundInterval] {
        guard var current = intervals.first else { return [] }
        var merged: [BrowserForegroundInterval] = []

        for interval in intervals.dropFirst() {
            if interval.start <= current.end {
                current = BrowserForegroundInterval(
                    start: current.start,
                    end: max(current.end, interval.end)
                )
            } else {
                merged.append(current)
                current = interval
            }
        }

        merged.append(current)
        return merged
    }
}

struct ChromiumHistoryVisit {
    let visitID: Int64
    let url: String
    let title: String
    let visitTime: Date
    let visitTimeMicros: Int64
    let recordedDuration: TimeInterval
}

struct EstimatedChromiumVisit {
    let url: String
    let title: String
    let visitTime: Date
    let visitDuration: TimeInterval
}

struct BrowserForegroundInterval {
    let start: Date
    let end: Date

    func contains(_ date: Date) -> Bool {
        start <= date && end > date
    }
}

private extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
