import Foundation
import SwiftUI

/// Main dashboard ViewModel bridging storage to the Today/dashboard UI.
/// Provides daily summary, today's sessions, and hourly activity for the density strip.
@MainActor
final class DashboardViewModel: ObservableObject {
    // MARK: - Published State

    @Published private(set) var dailySummary: DailySummary?
    @Published private(set) var todaySessions: [Session] = []
    @Published private(set) var isLoading = false
    @Published var selectedDate: Date
    @Published private(set) var appNames: [UUID: String] = [:]
    @Published private(set) var websiteDomains: [UUID: String] = [:]

    /// Hourly activity buckets for the density strip (0–23).
    /// Computed from todaySessions.
    var hourlyActivity: [HourlyActivityBucket] {
        computeHourlyActivity(from: todaySessions)
    }

    // MARK: - Dependencies

    private let store: ActivityStore?

    // MARK: - Init

    convenience init() {
        self.init(store: ServiceContainer.shared.store, selectedDate: Date())
    }

    init(store: ActivityStore?, selectedDate: Date = Date()) {
        self.store = store
        self.selectedDate = selectedDate

        NotificationCenter.default.addObserver(
            forName: AppConstants.NotificationNames.newSessionRecorded,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.loadToday()
            }
        }
    }

    // MARK: - Public Methods

    /// Load today's sessions and summary for the selected date.
    func loadToday() {
        guard let store = store else { return }

        Task {
            isLoading = true
            defer { isLoading = false }

            let start = DateFormatters.startOfDay(selectedDate)
            let end = DateFormatters.endOfDay(selectedDate)

            do {
                async let sessionsTask: [Session] = store.fetchSessions(from: start, to: end, significantOnly: false)
                async let summaryTask: DailySummary? = store.fetchDailySummary(for: start)

                let (sessions, summary) = try await (sessionsTask, summaryTask)

                todaySessions = sessions
                dailySummary = summary

                let apps = try await store.fetchAllApps()
                appNames = Dictionary(uniqueKeysWithValues: apps.map { ($0.id, $0.name) })
                let websites = try await store.fetchAllWebsites()
                websiteDomains = Dictionary(uniqueKeysWithValues: websites.map { ($0.id, $0.domain) })
            } catch {
                todaySessions = []
                dailySummary = nil
            }
        }
    }

    /// Refresh the daily summary for the selected date.
    func refreshSummary() {
        guard let store = store else { return }

        Task {
            isLoading = true
            defer { isLoading = false }

            let start = DateFormatters.startOfDay(selectedDate)

            do {
                dailySummary = try await store.fetchDailySummary(for: start)
            } catch {
                dailySummary = nil
            }
        }
    }

    /// Trigger AI summary generation for the selected date.
    /// Uses ConversationManager for real AI generation when available.
    func generateAISummary() {
        guard let store = store else { return }

        Task {
            isLoading = true
            defer { isLoading = false }

            let start = DateFormatters.startOfDay(selectedDate)

            do {
                var summary = try await store.fetchDailySummary(for: start)
                    ?? DailySummary(date: start)

                if let conversationManager = ServiceContainer.shared.conversationManager {
                    let aiText = try await conversationManager.generateDailySummary(for: selectedDate)
                    summary.aiSummary = aiText
                } else {
                    summary.aiSummary = "AI is not configured. Add your Anthropic API key in Settings to enable AI summaries."
                }

                summary.generatedAt = Date()
                try await store.upsertDailySummary(summary)

                dailySummary = summary
            } catch {
                // Preserve existing summary on error
            }
        }
    }

    // MARK: - Private Helpers

    private func computeHourlyActivity(from sessions: [Session]) -> [HourlyActivityBucket] {
        var hourToMinutes: [Int: TimeInterval] = [:]
        var hourToCategoryDuration: [Int: [ActivityCategory: TimeInterval]] = [:]

        let calendar = Calendar.current

        for session in sessions {
            let startHour = calendar.component(.hour, from: session.startTime)
            let endHour = calendar.component(.hour, from: session.endTime)
            let activeDuration = session.activeDuration

            for hour in startHour...endHour {
                let hourStart = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: session.startTime)!
                let hourEnd = calendar.date(byAdding: .hour, value: 1, to: hourStart)!
                let overlapStart = max(session.startTime, hourStart)
                let overlapEnd = min(session.endTime, hourEnd)
                let minutesInHour = max(0, overlapEnd.timeIntervalSince(overlapStart)) / 60.0

                hourToMinutes[hour, default: 0] += minutesInHour
                hourToCategoryDuration[hour, default: [:]][session.category, default: 0] += minutesInHour
            }
        }

        return (0..<24).map { hour in
            let activeMinutes = hourToMinutes[hour] ?? 0
            let categoryDurations = hourToCategoryDuration[hour] ?? [:]
            let dominantCategory = categoryDurations
                .max(by: { $0.value < $1.value })?
                .key ?? ActivityCategory.uncategorized

            return HourlyActivityBucket(
                id: hour,
                activeMinutes: activeMinutes,
                dominantCategory: dominantCategory
            )
        }
    }
}
