import SwiftUI

/// The main three-column app shell.
struct MainShell: View {
    @Environment(AppState.self) private var appState
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        @Bindable var state = appState

        NavigationSplitView(columnVisibility: $columnVisibility) {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 180, ideal: DS.sidebarWidth, max: 280)
        } content: {
            VStack(spacing: 0) {
                HeaderBar()
                Divider()
                contentView
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationSplitViewColumnWidth(min: 400, ideal: 600)
        } detail: {
            InspectorPanel()
                .navigationSplitViewColumnWidth(min: 250, ideal: 320, max: 400)
        }
        .navigationSplitViewStyle(.balanced)
    }

    @ViewBuilder
    private var contentView: some View {
        switch appState.selectedSection {
        case .today:
            TodayView()
        case .apps:
            AppsView()
        case .browsers:
            BrowsersView()
        case .websites:
            WebsitesView()
        case .history:
            HistoryView()
        case .insights:
            InsightsView()
        case .settings:
            SettingsView()
        }
    }
}
