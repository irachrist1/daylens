import Foundation
import GRDB

struct DailySummary: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "daily_summaries"

    var id: String
    var dateKey: String               // YYYY-MM-DD, UNIQUE
    var totalActiveSeconds: Double
    var topAppsJson: String?          // JSON: [{bundleId, name, seconds}]
    var topSitesJson: String?         // JSON: [{domain, seconds}]
    var focusScore: Double?           // 0.0 – 1.0
    var fragmentCount: Int?           // context switches count
    var aiNarrative: String?          // AI-generated summary text
    var aiModelUsed: String?
    var generatedAt: Double?

    var generatedDate: Date? { generatedAt.map { Date(timeIntervalSince1970: $0) } }

    init(
        id: String = UUID().uuidString,
        dateKey: String,
        totalActiveSeconds: Double = 0,
        topAppsJson: String? = nil,
        topSitesJson: String? = nil,
        focusScore: Double? = nil,
        fragmentCount: Int? = nil,
        aiNarrative: String? = nil,
        aiModelUsed: String? = nil,
        generatedAt: Double? = nil
    ) {
        self.id = id
        self.dateKey = dateKey
        self.totalActiveSeconds = totalActiveSeconds
        self.topAppsJson = topAppsJson
        self.topSitesJson = topSitesJson
        self.focusScore = focusScore
        self.fragmentCount = fragmentCount
        self.aiNarrative = aiNarrative
        self.aiModelUsed = aiModelUsed
        self.generatedAt = generatedAt
    }

    // Decoded convenience accessors
    var topApps: [AppUsageEntry] {
        guard let json = topAppsJson,
              let data = json.data(using: .utf8),
              let entries = try? JSONDecoder().decode([AppUsageEntry].self, from: data)
        else { return [] }
        return entries
    }

    var topSites: [SiteUsageEntry] {
        guard let json = topSitesJson,
              let data = json.data(using: .utf8),
              let entries = try? JSONDecoder().decode([SiteUsageEntry].self, from: data)
        else { return [] }
        return entries
    }
}

struct AppUsageEntry: Codable, Identifiable {
    var id: String { bundleId }
    let bundleId: String
    let name: String
    let seconds: Double
}

struct SiteUsageEntry: Codable, Identifiable {
    var id: String { domain }
    let domain: String
    let seconds: Double
}
