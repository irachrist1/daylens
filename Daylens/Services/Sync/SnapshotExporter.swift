import Foundation
import CryptoKit

/// Reads combinedDayPayload() and serializes a DaySnapshot JSON document
/// matching the locked v1 contract.
///
/// All database access runs inside Task.detached (never on main actor).
final class SnapshotExporter {

    // MARK: - Types matching the locked DaySnapshot contract

    struct DaySnapshot: Codable {
        let schemaVersion: Int
        let deviceId: String
        let platform: String
        let date: String
        let generatedAt: String
        let isPartialDay: Bool
        let focusScore: Int
        let focusSeconds: Int
        let appSummaries: [AppSummaryDTO]
        let categoryTotals: [CategoryTotalDTO]
        let timeline: [TimelineEntryDTO]
        let topDomains: [TopDomainDTO]
        let categoryOverrides: [String: String]
        let aiSummary: String?
        let focusSessions: [FocusSessionDTO]
    }

    struct AppSummaryDTO: Codable {
        let appKey: String
        let displayName: String
        let category: String
        let totalSeconds: Int
        let sessionCount: Int
    }

    struct CategoryTotalDTO: Codable {
        let category: String
        let totalSeconds: Int
    }

    struct TimelineEntryDTO: Codable {
        let appKey: String
        let startAt: String
        let endAt: String
    }

    struct TopDomainDTO: Codable {
        let domain: String
        let seconds: Int
        let category: String
    }

    struct FocusSessionDTO: Codable {
        let sourceId: String
        let startAt: String
        let endAt: String
        let actualDurationSec: Int
        let targetMinutes: Int
        let status: String
    }

    // MARK: - Normalization

    private struct NormalizationMap: Decodable {
        let aliases: [String: String]
        let catalog: [String: CatalogEntry]
    }

    private struct CatalogEntry: Decodable {
        let displayName: String
        let defaultCategory: String
    }

    private let normalizationMap: NormalizationMap

    // MARK: - Init

    init() {
        if let url = Bundle.main.url(forResource: "app-normalization.v1", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let map = try? JSONDecoder().decode(NormalizationMap.self, from: data) {
            normalizationMap = map
        } else {
            normalizationMap = NormalizationMap(aliases: [:], catalog: [:])
        }
    }

    // MARK: - Public

    /// Build a DaySnapshot JSON blob for the given date.
    /// Must be called from Task.detached — never on main actor.
    func exportSnapshot(for date: Date, deviceId: String) throws -> Data {
        let payload = try AppDatabase.shared.combinedDayPayload(for: date)
        let focusSessions = try AppDatabase.shared.focusSessions(for: date)
        let snapshot = buildSnapshot(
            payload: payload,
            focusSessions: focusSessions,
            date: date,
            deviceId: deviceId
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(snapshot)
    }

    // MARK: - Private

    private func buildSnapshot(
        payload: CombinedDayPayload,
        focusSessions: [FocusSessionRecord],
        date: Date,
        deviceId: String
    ) -> DaySnapshot {
        let dateString = Self.dateFormatter.string(from: date)
        let isPartialDay = Calendar.current.isDateInToday(date)

        // Apply normalization to app summaries
        let appDTOs = payload.appSummaries.map { app -> AppSummaryDTO in
            let (appKey, displayName) = normalize(bundleID: app.bundleID, appName: app.appName)
            let category = resolvedCategory(
                bundleID: app.bundleID,
                appKey: appKey,
                originalCategory: app.category,
                overrides: payload.categoryOverrides
            )
            return AppSummaryDTO(
                appKey: appKey,
                displayName: displayName,
                category: category,
                totalSeconds: Int(app.totalDuration),
                sessionCount: app.sessionCount
            )
        }

        // Category totals from app summaries after overrides
        var categoryMap: [String: Int] = [:]
        for app in appDTOs {
            categoryMap[app.category, default: 0] += app.totalSeconds
        }
        let categoryTotals = categoryMap.map { CategoryTotalDTO(category: $0.key, totalSeconds: $0.value) }
            .sorted { $0.totalSeconds > $1.totalSeconds }

        // Timeline
        let timelineDTOs = payload.timeline.map { session -> TimelineEntryDTO in
            let (appKey, _) = normalize(bundleID: session.bundleID, appName: session.appName)
            return TimelineEntryDTO(
                appKey: appKey,
                startAt: Self.iso8601Formatter.string(from: session.startTime),
                endAt: Self.iso8601Formatter.string(from: session.endTime)
            )
        }

        // Top domains from website summaries
        let topDomains = payload.websiteSummaries.prefix(20).map { site -> TopDomainDTO in
            let domainCategory = DomainIntelligence.classify(domain: site.domain).category
            return TopDomainDTO(
                domain: site.domain,
                seconds: Int(site.totalDuration),
                category: categoryRawValue(domainCategory)
            )
        }

        // Category overrides as [bundleID: categoryString]
        let overrideMap = payload.categoryOverrides.reduce(into: [String: String]()) { result, pair in
            result[pair.key] = categoryRawValue(pair.value)
        }

        // Focus score
        let totalTracked = appDTOs.reduce(0) { $0 + $1.totalSeconds }
        let focusedSeconds = appDTOs
            .filter { Self.focusedCategories.contains($0.category) }
            .reduce(0) { $0 + $1.totalSeconds }
        let switchesPerHour: Double
        if let summary = payload.dailySummary, summary.totalActiveTime > 0 {
            let hours = summary.totalActiveTime / 3600.0
            switchesPerHour = hours > 0 ? Double(summary.contextSwitches) / hours : 0
        } else {
            switchesPerHour = 0
        }
        let focusScore = Self.computeFocusScore(
            focusedSeconds: focusedSeconds,
            totalTracked: totalTracked,
            switchesPerHour: switchesPerHour
        )

        // Focus sessions
        let focusSessionDTOs = focusSessions.map { session -> FocusSessionDTO in
            FocusSessionDTO(
                sourceId: String(session.id ?? 0),
                startAt: Self.iso8601Formatter.string(from: session.startTime),
                endAt: Self.iso8601Formatter.string(from: session.endTime ?? session.startTime),
                actualDurationSec: Int(session.actualDuration),
                targetMinutes: session.targetMinutes,
                status: session.status.snapshotValue
            )
        }

        return DaySnapshot(
            schemaVersion: 1,
            deviceId: deviceId,
            platform: "macos",
            date: dateString,
            generatedAt: Self.iso8601Formatter.string(from: Date()),
            isPartialDay: isPartialDay,
            focusScore: focusScore,
            focusSeconds: focusedSeconds,
            appSummaries: appDTOs,
            categoryTotals: categoryTotals,
            timeline: timelineDTOs,
            topDomains: topDomains,
            categoryOverrides: overrideMap,
            aiSummary: payload.dailySummary?.aiSummary,
            focusSessions: focusSessionDTOs
        )
    }

    // MARK: - Normalization helpers

    private func normalize(bundleID: String, appName: String) -> (appKey: String, displayName: String) {
        let lowered = bundleID.lowercased()
            .replacingOccurrences(of: ".app", with: "")
            .replacingOccurrences(of: ".exe", with: "")

        // Try alias lookup
        if let appKey = normalizationMap.aliases[bundleID] ?? normalizationMap.aliases[lowered] {
            let display = normalizationMap.catalog[appKey]?.displayName ?? appName
            return (appKey, display)
        }

        // Fallback: use normalized raw name
        let fallbackKey = lowered
            .split(separator: ".")
            .last
            .map(String.init) ?? lowered
        return (fallbackKey, appName)
    }

    private func resolvedCategory(
        bundleID: String,
        appKey: String,
        originalCategory: AppCategory,
        overrides: [String: AppCategory]
    ) -> String {
        if let override = overrides[bundleID] {
            return categoryRawValue(override)
        }
        // Check catalog default
        if let catalogEntry = normalizationMap.catalog[appKey] {
            return catalogEntry.defaultCategory
        }
        return categoryRawValue(originalCategory)
    }

    /// Convert macOS AppCategory raw values ("Development", "AI Tools") to snapshot format ("development", "aiTools").
    private func categoryRawValue(_ category: AppCategory) -> String {
        switch category {
        case .development: return "development"
        case .communication: return "communication"
        case .research: return "research"
        case .writing: return "writing"
        case .aiTools: return "aiTools"
        case .design: return "design"
        case .browsing: return "browsing"
        case .meetings: return "meetings"
        case .entertainment: return "entertainment"
        case .email: return "email"
        case .productivity: return "productivity"
        case .social: return "social"
        case .system: return "system"
        case .uncategorized: return "uncategorized"
        }
    }

    // MARK: - Focus score formula

    private static let focusedCategories: Set<String> = [
        "development", "writing", "design", "research", "aiTools"
    ]

    /// focusScore = round(100 * focusedRatio * (1 - min(switchesPerHour / 300, 0.15)))
    private static func computeFocusScore(focusedSeconds: Int, totalTracked: Int, switchesPerHour: Double) -> Int {
        guard totalTracked > 0 else { return 0 }
        let focusedRatio = Double(focusedSeconds) / Double(totalTracked)
        let penalty = min(switchesPerHour / 300.0, 0.15)
        return min(100, max(0, Int(round(100.0 * focusedRatio * (1.0 - penalty)))))
    }

    // MARK: - Formatters

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static let iso8601Formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withTimeZone]
        return f
    }()
}

// MARK: - FocusSessionStatus mapping

private extension FocusSessionStatus {
    var snapshotValue: String {
        switch self {
        case .completed: return "completed"
        case .stopped: return "cancelled"
        case .running: return "active"
        }
    }
}
