import Foundation
#if canImport(GRDB)
import GRDB
#endif

struct DailySummary: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var date: Date
    var totalActiveTime: TimeInterval
    var totalIdleTime: TimeInterval
    var topApps: [RankedItem]
    var topBrowsers: [RankedItem]
    var topWebsites: [RankedItem]
    var focusScore: Double
    var fragmentationScore: Double
    var sessionCount: Int
    var switchCount: Int
    var aiSummary: String?
    var generatedAt: Date?

    init(
        id: UUID = UUID(),
        date: Date,
        totalActiveTime: TimeInterval = 0,
        totalIdleTime: TimeInterval = 0,
        topApps: [RankedItem] = [],
        topBrowsers: [RankedItem] = [],
        topWebsites: [RankedItem] = [],
        focusScore: Double = 0,
        fragmentationScore: Double = 0,
        sessionCount: Int = 0,
        switchCount: Int = 0,
        aiSummary: String? = nil,
        generatedAt: Date? = nil
    ) {
        self.id = id
        self.date = date
        self.totalActiveTime = totalActiveTime
        self.totalIdleTime = totalIdleTime
        self.topApps = topApps
        self.topBrowsers = topBrowsers
        self.topWebsites = topWebsites
        self.focusScore = focusScore
        self.fragmentationScore = fragmentationScore
        self.sessionCount = sessionCount
        self.switchCount = switchCount
        self.aiSummary = aiSummary
        self.generatedAt = generatedAt
    }
}

struct RankedItem: Codable, Hashable, Sendable, Identifiable {
    var id: UUID
    var name: String
    var duration: TimeInterval
    var category: ActivityCategory
    var sessionCount: Int
    var percentage: Double

    init(
        id: UUID,
        name: String,
        duration: TimeInterval,
        category: ActivityCategory = .uncategorized,
        sessionCount: Int = 0,
        percentage: Double = 0
    ) {
        self.id = id
        self.name = name
        self.duration = duration
        self.category = category
        self.sessionCount = sessionCount
        self.percentage = percentage
    }
}

#if canImport(GRDB)
extension DailySummary: FetchableRecord, PersistableRecord {
    static let databaseTableName = "daily_summaries"

    enum Columns: String, ColumnExpression {
        case id, date, totalActiveTime, totalIdleTime
        case topApps, topBrowsers, topWebsites
        case focusScore, fragmentationScore
        case sessionCount, switchCount
        case aiSummary, generatedAt
    }
}
#endif

extension DailySummary {
    var totalTrackedTime: TimeInterval {
        totalActiveTime + totalIdleTime
    }

    var focusPercentage: Double {
        focusScore * 100
    }

    var fragmentationPercentage: Double {
        fragmentationScore * 100
    }

    var averageSessionDuration: TimeInterval {
        guard sessionCount > 0 else { return 0 }
        return totalActiveTime / Double(sessionCount)
    }
}
