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

struct HistoryView: View {
    var body: some View {
        EmptyStateView(
            icon: "clock.arrow.circlepath",
            title: "History",
            message: "Browse your activity history across days and weeks."
        )
    }
}
