import SwiftUI

/// The main two-column app shell.
struct MainShell: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 180, ideal: DS.sidebarWidth, max: 280)
        } detail: {
            VStack(spacing: 0) {
                if appState.selectedSection.showsDateNavigation {
                    HeaderBar()
                }
                contentView
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationSplitViewStyle(.balanced)
        .toolbar(removing: .sidebarToggle)
    }

    @ViewBuilder
    private var contentView: some View {
        switch appState.selectedSection {
        case .today:    TodayView()
        case .history:  HistoryView()
        case .apps:     AppsView()
        case .insights: InsightsView()
        case .settings: SettingsView()
        }
    }
}
