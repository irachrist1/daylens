import Foundation
import Observation

@Observable
final class AppsViewModel {
    var summaries: [AppUsageSummary] = []
    var selectedApp: AppUsageSummary?
    var detailSessions: [AppSession] = []
    var detailWebsites: [WebsiteUsageSummary] = []
    var isLoading = false
    var isLoadingDetail = false
    var error: String?
    /// Stable DB base duration per bundleID, latched on first injectLiveSession call
    /// and reset on every load(). Prevents timer-tick accumulation.
    private var liveSessionBase: [String: TimeInterval] = [:]

    func load(for date: Date) {
        isLoading = true
        error = nil
        liveSessionBase = [:]

        Task { @MainActor in
            defer { isLoading = false }

            do {
                let summaries = try await Task.detached(priority: .userInitiated) {
                    try AppDatabase.shared.appUsageSummaries(for: date)
                }.value

                liveSessionBase = [:]
                self.summaries = summaries

                if let existingSelection = selectedApp,
                   let refreshedSelection = summaries.first(where: { $0.bundleID == existingSelection.bundleID }) {
                    selectedApp = refreshedSelection
                } else {
                    selectedApp = summaries.first
                }

                if let selectedApp {
                    await loadDetail(for: selectedApp, date: date)
                } else {
                    detailSessions = []
                    detailWebsites = []
                }
            } catch {
                self.summaries = []
                self.selectedApp = nil
                self.detailSessions = []
                self.detailWebsites = []
                self.error = error.localizedDescription
            }
        }
    }

    func selectApp(_ app: AppUsageSummary, for date: Date) {
        guard selectedApp?.bundleID != app.bundleID else { return }
        selectedApp = app

        Task { @MainActor in
            await loadDetail(for: app, date: date)
        }
    }

    func setOverride(bundleID: String, category: AppCategory, for date: Date) {
        try? AppDatabase.shared.setCategoryOverride(bundleID: bundleID, category: category)
        load(for: date)
        NotificationCenter.default.post(name: .categoryOverrideChanged, object: nil)
    }

    func removeOverride(bundleID: String, for date: Date) {
        try? AppDatabase.shared.removeCategoryOverride(bundleID: bundleID)
        load(for: date)
        NotificationCenter.default.post(name: .categoryOverrideChanged, object: nil)
    }

    /// Merges the currently-active (unfinalised) session so the frontmost app
    /// always appears even before the user switches away from it.
    /// Uses a stable DB base so repeated timer-tick calls don't compound.
    func injectLiveSession(bundleID: String, appName: String, startedAt: Date, for date: Date) {
        guard Calendar.current.isDateInToday(date) else { return }
        let liveDuration = Date().timeIntervalSince(startedAt)
        guard liveDuration >= 3 else { return }
        let category = AppCategory.categorize(bundleID: bundleID, appName: appName)

        if let idx = summaries.firstIndex(where: { $0.bundleID == bundleID }) {
            let existing = summaries[idx]
            let base = liveSessionBase[bundleID, default: existing.totalDuration]
            liveSessionBase[bundleID] = base
            summaries[idx] = AppUsageSummary(
                bundleID: existing.bundleID,
                appName: existing.appName,
                totalDuration: base + liveDuration,
                sessionCount: existing.sessionCount,
                category: existing.category,
                isBrowser: existing.isBrowser
            )
        } else {
            summaries.append(AppUsageSummary(
                bundleID: bundleID,
                appName: appName,
                totalDuration: liveDuration,
                sessionCount: 1,
                category: category,
                isBrowser: false
            ))
            summaries.sort { $0.totalDuration > $1.totalDuration }
            if selectedApp == nil { selectedApp = summaries.first }
        }
    }

    private func loadDetail(for app: AppUsageSummary, date: Date) async {
        isLoadingDetail = true
        defer { isLoadingDetail = false }

        do {
            let payload = try await Task.detached(priority: .userInitiated) {
                (
                    sessions: try AppDatabase.shared.appSessions(for: date, bundleID: app.bundleID),
                    websites: try AppDatabase.shared.websiteVisitsForBrowser(date: date, browserBundleID: app.bundleID, limit: 10)
                )
            }.value

            guard selectedApp?.bundleID == app.bundleID else { return }

            detailSessions = payload.sessions.sorted { $0.startTime > $1.startTime }
            detailWebsites = payload.websites
        } catch {
            guard selectedApp?.bundleID == app.bundleID else { return }
            detailSessions = []
            detailWebsites = []
        }
    }
}
