import Foundation
import GRDB

/// Reads browser history from local SQLite database files.
/// This is the primary native browser tracking approach — no extensions needed.
final class BrowserHistoryReader {
    private let database: AppDatabase
    private var timer: Timer?
    private var lastReadTimestamps: [String: Date] = [:]

    init(database: AppDatabase) {
        self.database = database
    }

    func startPolling() {
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

        for (bundleID, relativePath) in Constants.browserHistoryPaths {
            guard !relativePath.isEmpty else {
                // Firefox needs special handling
                if bundleID == "org.mozilla.firefox" {
                    await readFirefoxHistory(homeDir: homeDir)
                }
                continue
            }

            let historyPath = (homeDir as NSString).appendingPathComponent(relativePath)
            await readBrowserHistory(at: historyPath, browserBundleID: bundleID)
        }
    }

    // MARK: - Chrome/Chromium-based browsers

    private func readBrowserHistory(at path: String, browserBundleID: String) async {
        guard FileManager.default.fileExists(atPath: path) else { return }

        // Chrome locks the database while running — copy to a temp file
        let tempPath = NSTemporaryDirectory() + "daylens_\(browserBundleID.replacingOccurrences(of: ".", with: "_"))_history.sqlite"
        do {
            if FileManager.default.fileExists(atPath: tempPath) {
                try FileManager.default.removeItem(atPath: tempPath)
            }
            try FileManager.default.copyItem(atPath: path, toPath: tempPath)
        } catch {
            return // Can't copy, browser might have exclusive lock
        }
        defer { try? FileManager.default.removeItem(atPath: tempPath) }

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
            print("Failed to read browser history for \(browserBundleID): \(error)")
        }
    }

    private func readChromiumHistory(from dbQueue: DatabaseQueue, browserBundleID: String) async throws {
        let lastRead = lastReadTimestamps[browserBundleID] ?? Calendar.current.startOfDay(for: Date())

        // Chrome stores time as microseconds since Jan 1, 1601
        let chromiumEpochOffset: Int64 = 11_644_473_600_000_000 // microseconds from 1601 to 1970
        let lastReadChromium = Int64(lastRead.timeIntervalSince1970 * 1_000_000) + chromiumEpochOffset

        let visits = try dbQueue.read { db -> [(url: String, title: String, visitTime: Date, visitDuration: TimeInterval)] in
            let rows = try Row.fetchAll(db, sql: """
                SELECT u.url, u.title, v.visit_time, v.visit_duration
                FROM visits v
                JOIN urls u ON v.url = u.id
                WHERE v.visit_time > ?
                ORDER BY v.visit_time ASC
                LIMIT 500
                """, arguments: [lastReadChromium])

            return rows.compactMap { row in
                let visitTimeMicros: Int64 = row["visit_time"]
                let epochMicros = visitTimeMicros - chromiumEpochOffset
                let visitDate = Date(timeIntervalSince1970: TimeInterval(epochMicros) / 1_000_000.0)
                let durationMicros: Int64 = row["visit_duration"] ?? 0
                let duration = TimeInterval(durationMicros) / 1_000_000.0

                return (
                    url: row["url"] as String,
                    title: (row["title"] as String?) ?? "",
                    visitTime: visitDate,
                    visitDuration: max(duration, Constants.minimumWebsiteVisitDuration)
                )
            }
        }

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

        if let lastVisit = visits.last {
            lastReadTimestamps[browserBundleID] = lastVisit.visitTime
        }
    }

    private func readSafariHistory(from dbQueue: DatabaseQueue, browserBundleID: String) async throws {
        let lastRead = lastReadTimestamps[browserBundleID] ?? Calendar.current.startOfDay(for: Date())

        // Safari stores time as seconds since Jan 1, 2001 (Mac absolute time / Core Data epoch)
        let macEpochOffset: TimeInterval = 978_307_200 // seconds from 1970 to 2001
        let lastReadMac = lastRead.timeIntervalSince1970 - macEpochOffset

        let visits = try dbQueue.read { db -> [(url: String, title: String?, visitTime: Date)] in
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
        }
    }

    // MARK: - Firefox

    private func readFirefoxHistory(homeDir: String) async {
        let profilesDir = (homeDir as NSString).appendingPathComponent("Library/Application Support/Firefox/Profiles")
        guard let profiles = try? FileManager.default.contentsOfDirectory(atPath: profilesDir) else { return }

        // Find the default profile (usually ends with .default-release)
        for profile in profiles where profile.contains("default") {
            let historyPath = (profilesDir as NSString).appendingPathComponent(profile + "/places.sqlite")
            guard FileManager.default.fileExists(atPath: historyPath) else { continue }

            let tempPath = NSTemporaryDirectory() + "daylens_firefox_history.sqlite"
            do {
                if FileManager.default.fileExists(atPath: tempPath) {
                    try FileManager.default.removeItem(atPath: tempPath)
                }
                try FileManager.default.copyItem(atPath: historyPath, toPath: tempPath)
            } catch { continue }
            defer { try? FileManager.default.removeItem(atPath: tempPath) }

            let lastRead = lastReadTimestamps["org.mozilla.firefox"] ?? Calendar.current.startOfDay(for: Date())
            let lastReadMicros = Int64(lastRead.timeIntervalSince1970 * 1_000_000)

            do {
                let dbQueue = try DatabaseQueue(path: tempPath)
                let visits = try dbQueue.read { db -> [(url: String, title: String?, visitTime: Date)] in
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
                        browserBundleID: "org.mozilla.firefox",
                        startTime: visit.visitTime,
                        endTime: visit.visitTime.addingTimeInterval(Constants.minimumWebsiteVisitDuration),
                        duration: Constants.minimumWebsiteVisitDuration,
                        confidence: .high,
                        source: .browserHistory
                    )
                    try? database.insertWebsiteVisit(websiteVisit)
                }

                if let lastVisit = visits.last {
                    lastReadTimestamps["org.mozilla.firefox"] = lastVisit.visitTime
                }
            } catch {
                print("Failed to read Firefox history: \(error)")
            }
            break // Only read one profile
        }
    }

    // MARK: - Helpers

    private func extractDomain(from urlString: String) -> String? {
        guard let url = URL(string: urlString),
              let host = url.host else { return nil }
        // Strip "www." prefix for cleaner display
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
