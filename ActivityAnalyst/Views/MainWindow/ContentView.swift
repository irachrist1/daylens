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
                    HSplitView {
                        mainContent
                            .frame(minWidth: 400)

                        if appState.showInspector {
                            InspectorView(
                                destination: appState.selectedDestination
                            )
                            .frame(
                                minWidth: Theme.inspectorMinWidth,
                                idealWidth: Theme.inspectorWidth,
                                maxWidth: Theme.inspectorMaxWidth
                            )
                        }
                    }
                }
            )
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    toolbarItems
                }
            }

            if appState.showCommandBar {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                    .onTapGesture {
                        appState.showCommandBar = false
                    }

                CommandBar(
                    isPresented: $appState.showCommandBar,
                    onNavigate: { destination in
                        appState.selectedDestination = destination
                    },
                    onAIQuery: { query in
                        appState.selectedDestination = .insights
                    }
                )
                .transition(.opacity.combined(with: .scale(scale: 0.95)))
            }

            if !appState.hasCompletedOnboarding {
                OnboardingView()
                    .transition(.opacity)
            }
        }
        .animation(Theme.animationMedium, value: appState.showCommandBar)
        .animation(Theme.animationMedium, value: appState.hasCompletedOnboarding)
    }

    @ViewBuilder
    private var mainContent: some View {
        switch appState.selectedDestination {
        case .today:
            TodayView()
        case .apps:
            AppsView()
        case .web:
            WebOverviewView()
        case .browsers:
            BrowsersView()
        case .websites:
            WebsitesView()
        case .insights:
            InsightsView()
        case .history:
            HistoryView()
        case .settings:
            SettingsView()
        }
    }

    @ViewBuilder
    private var toolbarItems: some View {
        Button {
            appState.toggleTracking()
        } label: {
            HStack(spacing: Theme.spacing4) {
                Circle()
                    .fill(appState.isTracking ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
                Text(appState.isTracking ? "Tracking" : "Paused")
                    .font(Theme.Typography.caption)
            }
        }
        .help(appState.isTracking ? "Pause tracking" : "Resume tracking")

        Button {
            appState.showInspector.toggle()
        } label: {
            Image(systemName: "sidebar.right")
        }
        .help("Toggle inspector")

        Button {
            appState.showCommandBar.toggle()
        } label: {
            Image(systemName: "command")
        }
        .help("Command bar (⌘K)")
        .keyboardShortcut("k", modifiers: .command)
    }
}

/// Combined web overview showing both browsers and websites together.
struct WebOverviewView: View {
    @StateObject private var browsersVM = BrowsersViewModel()
    @StateObject private var websitesVM = WebsitesViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing24) {
                Text("Web Activity")
                    .font(Theme.Typography.largeTitle)
                    .foregroundStyle(Theme.Colors.primaryText)

                Text("Browser and website usage across all tracked browsers.")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.secondaryText)

                if browsersVM.browserUsage.isEmpty && websitesVM.websiteUsage.isEmpty {
                    EmptyStateView(
                        icon: "network",
                        title: "No Web Data",
                        message: "Browser and website data will appear here as you browse. Install a browser extension for detailed website tracking."
                    )
                } else {
                    if !browsersVM.browserUsage.isEmpty {
                        VStack(alignment: .leading, spacing: Theme.spacing12) {
                            Text("Top Browsers")
                                .font(Theme.Typography.headline)
                            ForEach(browsersVM.browserUsage, id: \.browser.id) { item in
                                BrowserUsageRow(browser: item.browser, duration: item.duration, isSelected: false)
                            }
                        }
                    }

                    if !websitesVM.websiteUsage.isEmpty {
                        VStack(alignment: .leading, spacing: Theme.spacing12) {
                            Text("Top Websites")
                                .font(Theme.Typography.headline)
                            ForEach(websitesVM.websiteUsage, id: \.website.id) { item in
                                WebsiteUsageRow(website: item.website, duration: item.duration, sessionCount: item.sessionCount, isSelected: false)
                            }
                        }
                    }
                }
            }
            .padding(Theme.spacing24)
        }
        .background(Theme.Colors.background)
        .task {
            browsersVM.loadBrowsers()
            websitesVM.loadWebsites()
        }
    }
}

struct HistoryView: View {
    @State private var selectedDate = Date()
    @State private var summaries: [DailySummary] = []
    @State private var isLoading = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing24) {
                Text("History")
                    .font(Theme.Typography.largeTitle)
                    .foregroundStyle(Theme.Colors.primaryText)

                DatePicker("Select date", selection: $selectedDate, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .frame(maxWidth: 320)
                    .onChange(of: selectedDate) { _, _ in
                        loadHistory()
                    }

                if isLoading {
                    ProgressView()
                } else if summaries.isEmpty {
                    VStack(spacing: Theme.spacing12) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 32, weight: .light))
                            .foregroundStyle(Theme.Colors.tertiaryText)
                        Text("No activity recorded for this period")
                            .font(Theme.Typography.callout)
                            .foregroundStyle(Theme.Colors.tertiaryText)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, Theme.spacing32)
                } else {
                    ForEach(summaries) { summary in
                        HistoryDayCard(summary: summary)
                    }
                }
            }
            .padding(Theme.spacing24)
        }
        .background(Theme.Colors.background)
        .task {
            loadHistory()
        }
    }

    private func loadHistory() {
        guard let store = ServiceContainer.shared.store else { return }
        isLoading = true
        Task {
            do {
                let start = Calendar.current.date(byAdding: .day, value: -30, to: selectedDate)!
                let end = DateFormatters.endOfDay(selectedDate)
                summaries = try await store.fetchDailySummaries(from: start, to: end)
            } catch {
                summaries = []
            }
            isLoading = false
        }
    }
}

struct HistoryDayCard: View {
    let summary: DailySummary

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing8) {
            HStack {
                Text(DateFormatters.relativeDay(summary.date))
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)

                Spacer()

                Text(DurationFormatter.format(summary.totalActiveTime))
                    .font(Theme.Typography.monoBody)
                    .foregroundStyle(Theme.Colors.secondaryText)
            }

            HStack(spacing: Theme.spacing16) {
                Label("\(summary.sessionCount) sessions", systemImage: "rectangle.stack.fill")
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Colors.tertiaryText)

                Label("Focus: \(DurationFormatter.formatPercentage(summary.focusScore))", systemImage: "target")
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(
                        summary.focusScore > 0.5 ? Theme.Colors.focus : Theme.Colors.distraction
                    )

                Label("\(summary.switchCount) switches", systemImage: "arrow.left.arrow.right")
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            }

            if !summary.topApps.isEmpty {
                HStack(spacing: Theme.spacing4) {
                    ForEach(summary.topApps.prefix(5)) { app in
                        Text(app.name)
                            .font(Theme.Typography.caption)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Theme.Colors.category(app.category).opacity(0.15))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                }
            }
        }
        .padding(Theme.spacing12)
        .background(Theme.Colors.groupedBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
    }
}
