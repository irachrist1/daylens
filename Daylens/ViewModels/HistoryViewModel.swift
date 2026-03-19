import Foundation
import Observation

@Observable
final class HistoryViewModel {
    var dailySummaries: [DailySummary] = []
    var isLoading = false

    /// Last 14 days with placeholder zeros for days with no data
    var chartData: [(date: Date, hours: Double)] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        return (0..<14).reversed().map { offset in
            let date = calendar.date(byAdding: .day, value: -offset, to: today)!
            let summary = dailySummaries.first { calendar.isDate($0.date, inSameDayAs: date) }
            return (date: date, hours: (summary?.totalActiveTime ?? 0) / 3600.0)
        }
    }

    func load() {
        isLoading = true
        Task { @MainActor in
            dailySummaries = (try? AppDatabase.shared.recentDailySummaries(limit: 30)) ?? []
            isLoading = false
        }
    }
}
