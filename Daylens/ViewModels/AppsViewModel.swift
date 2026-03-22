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
    private var liveWebsiteBase: [String: TimeInterval] = [:]
    private var cachedOverrides: [String: AppCategory] = [:]

    func load(for date: Date) {
        isLoading = true
        error = nil
        liveSessionBase = [:]
        liveWebsiteBase = [:]

        Task { @MainActor in
            defer { isLoading = false }

            do {
                let (summaries, overrides) = try await Task.detached(priority: .userInitiated) {
                    (try AppDatabase.shared.appUsageSummaries(for: date),
                     (try? AppDatabase.shared.categoryOverrides()) ?? [:])
                }.value

                liveSessionBase = [:]
                liveWebsiteBase = [:]
                cachedOverrides = overrides
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
        let category = cachedOverrides[bundleID] ?? AppCategory.categorize(bundleID: bundleID, appName: appName)

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
            // For a brand-new app (no DB sessions yet) the base is 0 — the DB contributed
            // nothing. Latching 0 means subsequent ticks display (0 + freshLiveDuration)
            // rather than (initialLiveDuration + freshLiveDuration) which would double-count.
            liveSessionBase[bundleID] = 0
            let isBrowser = Constants.knownBrowserBundleIDs.contains(bundleID)
            summaries.append(AppUsageSummary(
                bundleID: bundleID,
                appName: appName,
                totalDuration: liveDuration,
                sessionCount: 1,
                category: category,
                isBrowser: isBrowser
            ))
            summaries.sort { $0.totalDuration > $1.totalDuration }
            if selectedApp == nil { selectedApp = summaries.first }
        }
    }

    func injectLiveWebsiteVisit(
        domain: String,
        url: String?,
        title: String?,
        startedAt: Date,
        browserBundleID: String,
        for date: Date
    ) {
        guard Calendar.current.isDateInToday(date) else { return }
        guard selectedApp?.bundleID == browserBundleID else { return }

        let liveDuration = max(0, Date().timeIntervalSince(startedAt))
        guard liveDuration > 0 else { return }

        if let idx = detailWebsites.firstIndex(where: { $0.domain == domain }) {
            let existing = detailWebsites[idx]
            let base = liveWebsiteBase[domain, default: existing.totalDuration]
            liveWebsiteBase[domain] = base
            detailWebsites[idx] = WebsiteUsageSummary(
                domain: existing.domain,
                totalDuration: base + liveDuration,
                visitCount: existing.visitCount,
                topPageTitle: existing.topPageTitle ?? title ?? url,
                confidence: existing.confidence,
                browserName: existing.browserName
            )
        } else {
            liveWebsiteBase[domain] = 0
            detailWebsites.append(
                WebsiteUsageSummary(
                    domain: domain,
                    totalDuration: liveDuration,
                    visitCount: 1,
                    topPageTitle: title ?? url,
                    confidence: .medium,
                    browserName: Constants.browserNames[browserBundleID] ?? "Browser"
                )
            )
        }

        detailWebsites.sort { lhs, rhs in
            if lhs.totalDuration == rhs.totalDuration {
                return lhs.domain.localizedCaseInsensitiveCompare(rhs.domain) == .orderedAscending
            }
            return lhs.totalDuration > rhs.totalDuration
        }
    }

    private func loadDetail(for app: AppUsageSummary, date: Date) async {
        isLoadingDetail = true
        defer { isLoadingDetail = false }

        do {
            liveWebsiteBase = [:]
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
