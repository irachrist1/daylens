import XCTest
@testable import ActivityAnalystCore

final class PerformanceTests: XCTestCase {

    // MARK: - Session Normalization Performance

    func testSessionNormalizationPerformanceWith1000Events() {
        let normalizer = SessionNormalizer()
        let events = generateRealisticWorkday(eventCount: 1000)

        measure {
            _ = normalizer.normalize(events: events)
        }
    }

    func testSessionNormalizationPerformanceWith5000Events() {
        let normalizer = SessionNormalizer()
        let events = generateRealisticWorkday(eventCount: 5000)

        measure {
            _ = normalizer.normalize(events: events)
        }
    }

    // MARK: - Event Debouncing Performance

    func testDebouncerPerformanceWith10000Events() {
        let debouncer = EventDebouncer()
        let events = generateRapidSwitchEvents(count: 10000)

        measure {
            _ = debouncer.processBatch(events)
        }
    }

    // MARK: - Session Merging Performance

    func testSessionMergingWith500Sessions() {
        let normalizer = SessionNormalizer()
        let sessions = generateMergeableSessions(count: 500)

        measure {
            _ = normalizer.mergeSessions(sessions)
        }
    }

    // MARK: - Focus Score Calculation

    func testFocusScorePerformanceWith1000Sessions() {
        let sessions = generateMixedSessions(count: 1000)

        measure {
            _ = SessionNormalizer.focusScore(for: sessions)
        }
    }

    func testFragmentationScorePerformanceWith1000Sessions() {
        let sessions = generateMixedSessions(count: 1000)

        measure {
            _ = SessionNormalizer.fragmentationScore(for: sessions)
        }
    }

    // MARK: - Daily Summary Building

    func testDailySummaryBuildPerformanceWith500Sessions() {
        let (sessions, apps, websites) = generateSummaryData(sessionCount: 500)

        let builder = DailySummaryBuilder(
            date: Date(),
            sessions: sessions,
            apps: apps,
            browsers: [:],
            websites: websites
        )

        measure {
            _ = builder.build()
        }
    }

    // MARK: - Privacy Filter Performance

    func testPrivacyFilterBatchPerformanceWith1000Events() {
        let filter = PrivacyFilter()
        let events = generateEventsWithURLs(count: 1000)

        measure {
            _ = filter.filterBatch(events)
        }
    }

    // MARK: - Duration Formatter Performance

    func testDurationFormatterPerformanceWith10000Calls() {
        let durations = (0..<10000).map { TimeInterval($0 * 7) }

        measure {
            for d in durations {
                _ = DurationFormatter.format(d)
            }
        }
    }

    // MARK: - Category Classification Performance

    func testCategoryClassificationPerformanceWith1000Items() {
        let bundleIds = Array(repeating: Array(AppRecord.knownCategories.keys), count: 100).flatMap { $0 }.prefix(1000)

        measure {
            for id in bundleIds {
                _ = AppRecord.inferCategory(for: id)
            }
        }
    }

    func testDomainClassificationPerformanceWith1000Items() {
        let domains = Array(repeating: Array(WebsiteRecord.knownDomainCategories.keys), count: 100).flatMap { $0 }.prefix(1000)

        measure {
            for domain in domains {
                _ = WebsiteRecord.inferCategory(for: domain)
            }
        }
    }

    // MARK: - Helpers

    private func generateRealisticWorkday(eventCount: Int) -> [ActivityEvent] {
        let start = Date()
        let apps = (0..<10).map { _ in UUID() }

        return (0..<eventCount).map { i in
            let offset = TimeInterval(i * 5)
            let isActivation = i % 2 == 0
            let appId = apps[i % apps.count]

            return ActivityEvent(
                timestamp: start.addingTimeInterval(offset),
                eventType: isActivation ? .appActivated : .appDeactivated,
                appId: appId,
                source: .native
            )
        }
    }

    private func generateRapidSwitchEvents(count: Int) -> [ActivityEvent] {
        let start = Date()
        let apps = (0..<5).map { _ in UUID() }

        return (0..<count).map { i in
            ActivityEvent(
                timestamp: start.addingTimeInterval(TimeInterval(i) * 0.5),
                eventType: .appActivated,
                appId: apps[i % apps.count],
                source: .native
            )
        }
    }

    private func generateMergeableSessions(count: Int) -> [Session] {
        let start = Date()
        let appId = UUID()

        return (0..<count).map { i in
            let offset = TimeInterval(i * 10)
            return Session(
                appId: i % 3 == 0 ? appId : UUID(),
                startTime: start.addingTimeInterval(offset),
                endTime: start.addingTimeInterval(offset + 6),
                duration: 6,
                category: ActivityCategory.allCases[i % ActivityCategory.allCases.count],
                isSignificant: true
            )
        }
    }

    private func generateMixedSessions(count: Int) -> [Session] {
        let start = Date()
        let categories: [ActivityCategory] = [.development, .communication, .entertainment, .social, .productivity]

        return (0..<count).map { i in
            let offset = TimeInterval(i * 30)
            let duration = TimeInterval([10, 60, 300, 600, 1800][i % 5])
            return Session(
                appId: UUID(),
                startTime: start.addingTimeInterval(offset),
                endTime: start.addingTimeInterval(offset + duration),
                duration: duration,
                category: categories[i % categories.count],
                isSignificant: duration >= 5
            )
        }
    }

    private func generateSummaryData(sessionCount: Int) -> ([Session], [UUID: AppRecord], [UUID: WebsiteRecord]) {
        let start = Date()
        let appIds = (0..<20).map { _ in UUID() }
        let websiteIds = (0..<15).map { _ in UUID() }

        var apps: [UUID: AppRecord] = [:]
        for (i, id) in appIds.enumerated() {
            apps[id] = AppRecord(id: id, bundleIdentifier: "com.test.app\(i)", name: "App \(i)")
        }

        var websites: [UUID: WebsiteRecord] = [:]
        for (i, id) in websiteIds.enumerated() {
            websites[id] = WebsiteRecord(id: id, domain: "site\(i).com")
        }

        let sessions = (0..<sessionCount).map { i in
            let offset = TimeInterval(i * 20)
            let duration = TimeInterval([10, 60, 180, 300, 600][i % 5])
            return Session(
                appId: appIds[i % appIds.count],
                websiteId: i % 3 == 0 ? websiteIds[i % websiteIds.count] : nil,
                startTime: start.addingTimeInterval(offset),
                endTime: start.addingTimeInterval(offset + duration),
                duration: duration,
                category: ActivityCategory.allCases[i % ActivityCategory.allCases.count],
                isSignificant: duration >= 5
            )
        }

        return (sessions, apps, websites)
    }

    private func generateEventsWithURLs(count: Int) -> [ActivityEvent] {
        let start = Date()
        return (0..<count).map { i in
            ActivityEvent(
                timestamp: start.addingTimeInterval(TimeInterval(i)),
                eventType: .tabChanged,
                appId: UUID(),
                url: "https://example.com/page?token=secret\(i)&user=test#section",
                pageTitle: "Page \(i)",
                source: .extension,
                isPrivateBrowsing: i % 5 == 0
            )
        }
    }
}
