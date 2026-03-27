import Foundation
import Observation

@Observable
final class AppsViewModel {
    var summaries: [AppUsageSummary] = []
    var appleLikeSummaries: [AppUsageSummary] = []
    var selectedBundleID: String?
    var detailSessions: [AppSession] = []
    var detailWebsites: [WebsiteUsageSummary] = []
    var isLoading = false
    var isLoadingDetail = false
    var error: String?
    /// Stable DB base duration per bundleID, latched on first injectLiveSession call
    /// and reset on every load(). Prevents timer-tick accumulation.
    private var liveSessionBase: [String: TimeInterval] = [:]
    private var liveAppleLikeSessionBase: [String: TimeInterval] = [:]
    private var liveWebsiteBase: [String: TimeInterval] = [:]
    private var liveWebsiteBrowserBase: [String: TimeInterval] = [:]
    private var cachedOverrides: [String: AppCategory] = [:]

    func load(for date: Date, metricMode: UsageMetricMode) {
        isLoading = true
        error = nil
        liveSessionBase = [:]
        liveAppleLikeSessionBase = [:]
        liveWebsiteBase = [:]
        liveWebsiteBrowserBase = [:]

        Task { @MainActor in
            defer { isLoading = false }

            do {
                let payload = try await Task.detached(priority: .userInitiated) {
                    (
                        meaningful: try AppDatabase.shared.appUsageSummaries(for: date, profile: .meaningful),
                        appleLike: try AppDatabase.shared.appUsageSummaries(for: date, profile: .appleLike),
                        overrides: (try? AppDatabase.shared.categoryOverrides()) ?? [:]
                    )
                }.value

                liveSessionBase = [:]
                liveAppleLikeSessionBase = [:]
                liveWebsiteBase = [:]
                liveWebsiteBrowserBase = [:]
                cachedOverrides = payload.overrides
                summaries = payload.meaningful
                appleLikeSummaries = payload.appleLike

                let displayed = displaySummaries(for: metricMode)
                if let selectedBundleID,
                   displayed.contains(where: { $0.bundleID == selectedBundleID }) {
                    self.selectedBundleID = selectedBundleID
                } else {
                    self.selectedBundleID = displayed.first?.bundleID
                }

                if let selectedApp = selectedApp(for: metricMode) {
                    await loadDetail(for: selectedApp, date: date, metricMode: metricMode)
                } else {
                    detailSessions = []
                    detailWebsites = []
                }
            } catch {
                self.summaries = []
                self.appleLikeSummaries = []
                self.selectedBundleID = nil
                self.detailSessions = []
                self.detailWebsites = []
                self.error = error.localizedDescription
            }
        }
    }

    func selectApp(_ app: AppUsageSummary, for date: Date, metricMode: UsageMetricMode) {
        guard selectedBundleID != app.bundleID else { return }
        selectedBundleID = app.bundleID

        Task { @MainActor in
            await loadDetail(for: app, date: date, metricMode: metricMode)
        }
    }

    func setOverride(bundleID: String, category: AppCategory, for date: Date, metricMode: UsageMetricMode = .meaningful) {
        try? AppDatabase.shared.setCategoryOverride(bundleID: bundleID, category: category)
        load(for: date, metricMode: metricMode)
        NotificationCenter.default.post(name: .categoryOverrideChanged, object: nil)
    }

    func removeOverride(bundleID: String, for date: Date, metricMode: UsageMetricMode = .meaningful) {
        try? AppDatabase.shared.removeCategoryOverride(bundleID: bundleID)
        load(for: date, metricMode: metricMode)
        NotificationCenter.default.post(name: .categoryOverrideChanged, object: nil)
    }

    /// Merges the currently-active (unfinalised) session so the frontmost app
    /// always appears even before the user switches away from it.
    /// Uses a stable DB base so repeated timer-tick calls don't compound.
    func injectLiveSession(
        bundleID: String,
        appName: String,
        startedAt: Date,
        for date: Date,
        includeInMeaningful: Bool = true,
        includeInAppleLike: Bool = true
    ) {
        guard Calendar.current.isDateInToday(date) else { return }
        let liveDuration = Date().timeIntervalSince(startedAt)
        guard liveDuration >= 3 else { return }
        let category = cachedOverrides[bundleID] ?? AppCategory.categorize(bundleID: bundleID, appName: appName)
        let isBrowser = Constants.knownBrowserBundleIDs.contains(bundleID)

        if includeInMeaningful {
            injectLiveSession(
                into: &summaries,
                baseStore: &liveSessionBase,
                bundleID: bundleID,
                appName: appName,
                liveDuration: liveDuration,
                category: category,
                isBrowser: isBrowser
            )
        }

        if includeInAppleLike {
            injectLiveSession(
                into: &appleLikeSummaries,
                baseStore: &liveAppleLikeSessionBase,
                bundleID: bundleID,
                appName: appName,
                liveDuration: liveDuration,
                category: category,
                isBrowser: isBrowser
            )
        }

        if selectedBundleID == nil {
            selectedBundleID = summaries.first?.bundleID ?? appleLikeSummaries.first?.bundleID
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
        guard selectedBundleID == browserBundleID else { return }

        let liveDuration = max(0, Date().timeIntervalSince(startedAt))
        guard liveDuration > 0 else { return }

        if let idx = detailWebsites.firstIndex(where: { $0.domain == domain }) {
            let existing = detailWebsites[idx]
            let base = liveWebsiteBase[domain, default: existing.totalDuration]
            liveWebsiteBase[domain] = base
            let browserBreakdowns = updatedBrowserBreakdowns(
                existing.browserBreakdowns,
                domain: domain,
                browserBundleID: browserBundleID,
                title: title ?? url,
                liveDuration: liveDuration
            )
            detailWebsites[idx] = WebsiteUsageSummary(
                domain: existing.domain,
                totalDuration: base + liveDuration,
                visitCount: existing.visitCount,
                topPageTitle: existing.representativePageTitle ?? title ?? url,
                confidence: existing.confidence,
                browserName: existing.browserName,
                activePageTitle: title ?? url,
                browserBreakdowns: browserBreakdowns
            )
        } else {
            liveWebsiteBase[domain] = 0
            liveWebsiteBrowserBase[websiteBrowserBaseKey(domain: domain, browserBundleID: browserBundleID)] = 0
            detailWebsites.append(
                WebsiteUsageSummary(
                    domain: domain,
                    totalDuration: liveDuration,
                    visitCount: 1,
                    topPageTitle: title ?? url,
                    confidence: .medium,
                    browserName: Constants.browserNames[browserBundleID] ?? "Browser",
                    activePageTitle: title ?? url,
                    browserBreakdowns: [
                        WebsiteBrowserBreakdown(
                            browserBundleID: browserBundleID,
                            browserName: Constants.browserNames[browserBundleID] ?? "Browser",
                            totalDuration: liveDuration,
                            representativePageTitle: title ?? url,
                            activePageTitle: title ?? url
                        )
                    ]
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

    func displaySummaries(for mode: UsageMetricMode) -> [AppUsageSummary] {
        switch mode {
        case .meaningful:
            return summaries
        case .appleLike:
            return appleLikeSummaries
        }
    }

    func selectedApp(for mode: UsageMetricMode) -> AppUsageSummary? {
        displaySummaries(for: mode).first(where: { $0.bundleID == selectedBundleID })
    }

    private func loadDetail(for app: AppUsageSummary, date: Date, metricMode: UsageMetricMode) async {
        isLoadingDetail = true
        defer { isLoadingDetail = false }

        do {
            liveWebsiteBase = [:]
            liveWebsiteBrowserBase = [:]
            let payload = try await Task.detached(priority: .userInitiated) {
                (
                    sessions: try AppDatabase.shared.appSessions(for: date, bundleID: app.bundleID, profile: metricMode),
                    websites: try AppDatabase.shared.websiteVisitsForBrowser(date: date, browserBundleID: app.bundleID, limit: 10)
                )
            }.value

            guard selectedBundleID == app.bundleID else { return }

            detailSessions = payload.sessions.sorted { $0.startTime > $1.startTime }
            detailWebsites = payload.websites
        } catch {
            guard selectedBundleID == app.bundleID else { return }
            detailSessions = []
            detailWebsites = []
        }
    }

    private func injectLiveSession(
        into summaries: inout [AppUsageSummary],
        baseStore: inout [String: TimeInterval],
        bundleID: String,
        appName: String,
        liveDuration: TimeInterval,
        category: AppCategory,
        isBrowser: Bool
    ) {
        if let idx = summaries.firstIndex(where: { $0.bundleID == bundleID }) {
            let existing = summaries[idx]
            let base = baseStore[bundleID, default: existing.totalDuration]
            baseStore[bundleID] = base
            summaries[idx] = AppUsageSummary(
                bundleID: existing.bundleID,
                appName: existing.appName,
                totalDuration: base + liveDuration,
                sessionCount: existing.sessionCount,
                category: existing.category,
                isBrowser: existing.isBrowser
            )
        } else {
            baseStore[bundleID] = 0
            summaries.append(AppUsageSummary(
                bundleID: bundleID,
                appName: appName,
                totalDuration: liveDuration,
                sessionCount: 1,
                category: category,
                isBrowser: isBrowser
            ))
        }

        summaries.sort { lhs, rhs in
            if lhs.totalDuration == rhs.totalDuration {
                return lhs.appName.localizedCaseInsensitiveCompare(rhs.appName) == .orderedAscending
            }
            return lhs.totalDuration > rhs.totalDuration
        }
    }

    private func updatedBrowserBreakdowns(
        _ breakdowns: [WebsiteBrowserBreakdown],
        domain: String,
        browserBundleID: String,
        title: String?,
        liveDuration: TimeInterval
    ) -> [WebsiteBrowserBreakdown] {
        let browserName = Constants.browserNames[browserBundleID] ?? "Browser"
        let key = websiteBrowserBaseKey(domain: domain, browserBundleID: browserBundleID)

        if let existingBreakdown = breakdowns.first(where: { $0.browserBundleID == browserBundleID }) {
            let base = liveWebsiteBrowserBase[key, default: existingBreakdown.totalDuration]
            liveWebsiteBrowserBase[key] = base

            return breakdowns.map { breakdown in
                guard breakdown.browserBundleID == browserBundleID else { return breakdown }
                return WebsiteBrowserBreakdown(
                    browserBundleID: breakdown.browserBundleID,
                    browserName: breakdown.browserName,
                    totalDuration: base + liveDuration,
                    representativePageTitle: breakdown.representativePageTitle,
                    activePageTitle: title
                )
            }
        }

        liveWebsiteBrowserBase[key] = 0
        return breakdowns + [
            WebsiteBrowserBreakdown(
                browserBundleID: browserBundleID,
                browserName: browserName,
                totalDuration: liveDuration,
                representativePageTitle: title,
                activePageTitle: title
            )
        ]
    }

    private func websiteBrowserBaseKey(domain: String, browserBundleID: String) -> String {
        "\(domain)||\(browserBundleID)"
    }
}
