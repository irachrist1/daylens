import Foundation
import GRDB

extension Notification.Name {
    static let categoryOverrideChanged = Notification.Name("DaylensCategoryOverrideChanged")
}

/// A normalized session of app usage after merging and deduplication.
struct AppSession: Codable, Identifiable, FetchableRecord, PersistableRecord {
    var id: Int64?
    var date: Date          // Calendar day (start of day)
    var bundleID: String
    var appName: String
    var startTime: Date
    var endTime: Date
    var duration: TimeInterval
    var category: AppCategory
    var isBrowser: Bool

    static let databaseTableName = "app_sessions"

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }

    var formattedDuration: String {
        let hours = Int(duration) / 3600
        let minutes = (Int(duration) % 3600) / 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        if minutes > 0 { return "\(minutes)m" }
        let seconds = Int(duration) % 60
        return "\(seconds)s"
    }

    var classification: AppClassification {
        let base = AppCategory.classify(bundleID: bundleID, appName: appName)
        guard base.category == category else {
            return AppClassification(category: category, semanticLabel: nil, confidence: .high, rule: "user-override")
        }
        return base
    }
}

/// Aggregated app usage for a given day.
struct AppUsageSummary: Identifiable {
    let bundleID: String
    let appName: String
    let totalDuration: TimeInterval
    let sessionCount: Int
    let category: AppCategory
    let isBrowser: Bool

    var id: String { bundleID }

    var formattedDuration: String {
        let hours = Int(totalDuration) / 3600
        let minutes = (Int(totalDuration) % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        if minutes > 0 {
            return "\(minutes)m"
        }
        let seconds = Int(totalDuration) % 60
        return "\(seconds)s"
    }

    var durationHours: Double {
        totalDuration / 3600.0
    }

    var classification: AppClassification {
        let base = AppCategory.classify(bundleID: bundleID, appName: appName)
        guard base.category == category else {
            // category was overridden by user — wrap it so callers see the right value
            return AppClassification(category: category, semanticLabel: nil, confidence: .high, rule: "user-override")
        }
        return base
    }

    var semanticLabel: String? {
        classification.semanticLabel
    }

    var classificationConfidence: AppClassificationConfidence {
        classification.confidence
    }
}

struct CategoryUsageSummary: Identifiable {
    let category: AppCategory
    let totalDuration: TimeInterval
    let appCount: Int
    let sessionCount: Int
    let topApps: [String]
    let containsLowConfidenceApps: Bool

    var id: String { category.rawValue }

    var formattedDuration: String {
        let hours = Int(totalDuration) / 3600
        let minutes = (Int(totalDuration) % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        if minutes > 0 {
            return "\(minutes)m"
        }
        let seconds = Int(totalDuration) % 60
        return "\(seconds)s"
    }
}

enum SemanticUsageRollups {
    static func categorySummaries(from appSummaries: [AppUsageSummary]) -> [CategoryUsageSummary] {
        Dictionary(grouping: appSummaries, by: { $0.classification.category })
            .map { category, items in
                let sortedItems = items.sorted { lhs, rhs in
                    if lhs.totalDuration == rhs.totalDuration {
                        return lhs.appName.localizedCaseInsensitiveCompare(rhs.appName) == .orderedAscending
                    }
                    return lhs.totalDuration > rhs.totalDuration
                }

                return CategoryUsageSummary(
                    category: category,
                    totalDuration: sortedItems.reduce(0) { $0 + $1.totalDuration },
                    appCount: sortedItems.count,
                    sessionCount: sortedItems.reduce(0) { $0 + $1.sessionCount },
                    topApps: Array(sortedItems.prefix(3).map(\.appName)),
                    containsLowConfidenceApps: sortedItems.contains { $0.classificationConfidence == .low }
                )
            }
            .sorted { lhs, rhs in
                if lhs.totalDuration == rhs.totalDuration {
                    return lhs.category.rawValue < rhs.category.rawValue
                }
                return lhs.totalDuration > rhs.totalDuration
            }
    }
}
