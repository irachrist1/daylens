import SwiftUI

/// Root content view implementing the three-column layout.
/// Left: Sidebar navigation
/// Center: Main content for selected destination
/// Right: Inspector panel
struct ContentView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        ZStack {
            NavigationSplitView(
                sidebar: {
                    SidebarView(selection: $appState.selectedDestination)
                        .navigationSplitViewColumnWidth(
                            min: Theme.sidebarMinWidth,
                            ideal: Theme.sidebarWidth,
                            max: Theme.sidebarMaxWidth
                        )
                },
                detail: {
                    mainContent
                        .frame(minWidth: 400)
                }
            )

            if !appState.hasCompletedOnboarding {
                OnboardingView()
                    .transition(.opacity)
            }
        }
        .animation(Theme.animationMedium, value: appState.hasCompletedOnboarding)
    }

    @ViewBuilder
    private var mainContent: some View {
        switch appState.selectedDestination {
        case .today:
            TodayView()
        case .apps:
            AppsView()
        case .web, .browsers, .websites:
            WebView()
        case .insights:
            InsightsView()
        case .history:
            HistoryView()
        case .settings:
            SettingsView()
        }
    }
}

/// Unified Web view: shows browsers with drill-down to websites.
struct WebView: View {
    @StateObject private var browsersVM = BrowsersViewModel()
    @StateObject private var websitesVM = WebsitesViewModel()
    @State private var selectedBrowserForDetail: BrowserRecord?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing24) {
                VStack(alignment: .leading, spacing: Theme.spacing4) {
                    Text("Web")
                        .font(Theme.Typography.largeTitle)
                        .foregroundStyle(Theme.Colors.primaryText)

                    Text("Browser and website usage")
                        .font(Theme.Typography.callout)
                        .foregroundStyle(Theme.Colors.secondaryText)
                }

                if browsersVM.browserUsage.isEmpty && websitesVM.websiteUsage.isEmpty {
                    EmptyStateView(
                        icon: "network",
                        title: "No Web Data",
                        message: "Browser and website data will appear here as you browse."
                    )
                } else {
                    browsersSection
                    topWebsitesSection
                }
            }
            .padding(Theme.spacing24)
        }
        .background(Theme.Colors.background)
        .task {
            browsersVM.loadBrowsers()
            websitesVM.loadWebsites()
        }
        .sheet(item: $selectedBrowserForDetail) { browser in
            BrowserWebsitesSheet(browser: browser, allWebsites: websitesVM.websiteUsage)
        }
    }

    private var browsersSection: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            Text("Browsers")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.primaryText)

            ForEach(browsersVM.browserUsage, id: \.browser.id) { item in
                HStack(spacing: Theme.spacing12) {
                    Image(systemName: "globe")
                        .font(.system(size: 20))
                        .foregroundStyle(Theme.Colors.accent)
                        .frame(width: 32, height: 32)
                        .background(Theme.Colors.accentSubtle)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))

                    VStack(alignment: .leading, spacing: Theme.spacing2) {
                        Text(item.browser.name)
                            .font(Theme.Typography.headline)
                            .foregroundStyle(Theme.Colors.primaryText)
                        Text("Tap to see websites")
                            .font(Theme.Typography.footnote)
                            .foregroundStyle(Theme.Colors.tertiaryText)
                    }

                    Spacer()

                    Text(DurationFormatter.format(item.duration))
                        .font(Theme.Typography.monoBody)
                        .foregroundStyle(Theme.Colors.primaryText)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.Colors.tertiaryText)
                }
                .padding(Theme.spacing12)
                .background(Theme.Colors.groupedBackground)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                .contentShape(Rectangle())
                .onTapGesture {
                    selectedBrowserForDetail = item.browser
                }
            }
        }
    }

    private var topWebsitesSection: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            Text("Top Websites")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.primaryText)

            if websitesVM.websiteUsage.isEmpty {
                Text("No website data yet")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            } else {
                ForEach(websitesVM.websiteUsage.prefix(10), id: \.website.id) { item in
                    HStack(spacing: Theme.spacing12) {
                        Image(systemName: item.website.category.sfSymbol)
                            .font(.system(size: 16))
                            .foregroundStyle(Theme.Colors.category(item.website.category))
                            .frame(width: 32, height: 32)
                            .background(Theme.Colors.category(item.website.category).opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))

                        VStack(alignment: .leading, spacing: Theme.spacing2) {
                            Text(item.website.domain)
                                .font(Theme.Typography.headline)
                                .foregroundStyle(Theme.Colors.primaryText)
                            Text("\(item.sessionCount) visit\(item.sessionCount == 1 ? "" : "s")")
                                .font(Theme.Typography.footnote)
                                .foregroundStyle(Theme.Colors.tertiaryText)
                        }

                        Spacer()

                        Text(DurationFormatter.format(item.duration))
                            .font(Theme.Typography.monoBody)
                            .foregroundStyle(Theme.Colors.primaryText)
                    }
                    .padding(Theme.spacing12)
                    .background(Theme.Colors.groupedBackground)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                }
            }
        }
    }
}

struct BrowserWebsitesSheet: View {
    let browser: BrowserRecord
    let allWebsites: [(website: WebsiteRecord, duration: TimeInterval, sessionCount: Int)]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(browser.name)
                        .font(Theme.Typography.title3)
                        .foregroundStyle(Theme.Colors.primaryText)
                    Text("Most visited websites")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Colors.secondaryText)
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(Theme.Colors.tertiaryText)
                }
                .buttonStyle(.plain)
            }
            .padding(Theme.spacing16)

            Divider()

            if allWebsites.isEmpty {
                Spacer()
                Text("No websites tracked for this browser yet")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.tertiaryText)
                Spacer()
            } else {
                ScrollView {
                    VStack(spacing: Theme.spacing8) {
                        ForEach(allWebsites, id: \.website.id) { item in
                            HStack(spacing: Theme.spacing12) {
                                Image(systemName: item.website.category.sfSymbol)
                                    .font(.system(size: 14))
                                    .foregroundStyle(Theme.Colors.category(item.website.category))
                                    .frame(width: 28, height: 28)
                                    .background(Theme.Colors.category(item.website.category).opacity(0.1))
                                    .clipShape(RoundedRectangle(cornerRadius: 6))

                                VStack(alignment: .leading, spacing: 1) {
                                    Text(item.website.domain)
                                        .font(Theme.Typography.body)
                                        .foregroundStyle(Theme.Colors.primaryText)
                                    Text("\(item.sessionCount) visit\(item.sessionCount == 1 ? "" : "s") · \(item.website.category.displayName)")
                                        .font(Theme.Typography.footnote)
                                        .foregroundStyle(Theme.Colors.tertiaryText)
                                }

                                Spacer()

                                Text(DurationFormatter.format(item.duration))
                                    .font(Theme.Typography.monoSmall)
                                    .foregroundStyle(Theme.Colors.secondaryText)
                            }
                            .padding(Theme.spacing8)
                        }
                    }
                    .padding(Theme.spacing16)
                }
            }
        }
        .frame(minWidth: 400, minHeight: 300, idealHeight: 500)
        .background(Theme.Colors.background)
    }
}

struct HistoryView: View {
    @State private var summaries: [DailySummary] = []
    @State private var isLoading = false
    @State private var dayRange = 14

    private var maxActiveTime: TimeInterval {
        summaries.map(\.totalActiveTime).max() ?? 1
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing24) {
                VStack(alignment: .leading, spacing: Theme.spacing4) {
                    Text("History")
                        .font(Theme.Typography.largeTitle)
                        .foregroundStyle(Theme.Colors.primaryText)

                    Text("Activity trends over the last \(dayRange) days")
                        .font(Theme.Typography.callout)
                        .foregroundStyle(Theme.Colors.secondaryText)
                }

                Picker("Range", selection: $dayRange) {
                    Text("7 days").tag(7)
                    Text("14 days").tag(14)
                    Text("30 days").tag(30)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 280)
                .onChange(of: dayRange) { _, _ in loadHistory() }

                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, Theme.spacing32)
                } else if summaries.isEmpty {
                    EmptyStateView(
                        icon: "clock.arrow.circlepath",
                        title: "No History",
                        message: "Activity data will appear here as you use your Mac."
                    )
                } else {
                    activeTimeChart
                    focusChart
                    dailyBreakdown
                }
            }
            .padding(Theme.spacing24)
        }
        .background(Theme.Colors.background)
        .task { loadHistory() }
    }

    private var activeTimeChart: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            Text("Active Time")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.primaryText)

            HStack(alignment: .bottom, spacing: 3) {
                ForEach(summaries.reversed()) { summary in
                    VStack(spacing: Theme.spacing4) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Theme.Colors.accent)
                            .frame(
                                width: max(8, (CGFloat(1) / CGFloat(max(summaries.count, 1))) * 500),
                                height: max(4, CGFloat(summary.totalActiveTime / max(maxActiveTime, 1)) * 120)
                            )

                        Text(shortDayLabel(summary.date))
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(Theme.Colors.tertiaryText)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.spacing16)
            .background(Theme.Colors.groupedBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
        }
    }

    private var focusChart: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            Text("Focus Score")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.primaryText)

            HStack(alignment: .bottom, spacing: 3) {
                ForEach(summaries.reversed()) { summary in
                    VStack(spacing: Theme.spacing4) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(summary.focusScore > 0.5 ? Theme.Colors.focus : Theme.Colors.distraction)
                            .frame(
                                width: max(8, (CGFloat(1) / CGFloat(max(summaries.count, 1))) * 500),
                                height: max(4, CGFloat(summary.focusScore) * 120)
                            )

                        Text(shortDayLabel(summary.date))
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(Theme.Colors.tertiaryText)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.spacing16)
            .background(Theme.Colors.groupedBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
        }
    }

    private var dailyBreakdown: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            Text("Daily Breakdown")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.primaryText)

            ForEach(summaries) { summary in
                HistoryDayRow(summary: summary)
            }
        }
    }

    private func shortDayLabel(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "d"
        return f.string(from: date)
    }

    private func loadHistory() {
        guard let store = ServiceContainer.shared.store else { return }
        isLoading = true
        Task {
            do {
                let start = Calendar.current.date(byAdding: .day, value: -dayRange, to: Date())!
                let end = DateFormatters.endOfDay(Date())
                summaries = try await store.fetchDailySummaries(from: start, to: end)
            } catch {
                summaries = []
            }
            isLoading = false
        }
    }
}

struct HistoryDayRow: View {
    let summary: DailySummary

    var body: some View {
        HStack(spacing: Theme.spacing12) {
            VStack(alignment: .leading, spacing: Theme.spacing2) {
                Text(DateFormatters.relativeDay(summary.date))
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)

                HStack(spacing: Theme.spacing8) {
                    Label("\(summary.sessionCount) sessions", systemImage: "rectangle.stack.fill")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Colors.tertiaryText)

                    Label("Focus \(DurationFormatter.formatPercentage(summary.focusScore))", systemImage: "target")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(
                            summary.focusScore > 0.5 ? Theme.Colors.focus : Theme.Colors.distraction
                        )
                }
            }

            Spacer()

            Text(DurationFormatter.format(summary.totalActiveTime))
                .font(Theme.Typography.monoBody)
                .foregroundStyle(Theme.Colors.primaryText)
        }
        .padding(Theme.spacing12)
        .background(Theme.Colors.groupedBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
    }
}
