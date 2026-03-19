import SwiftUI

/// The main two-column app shell.
/// Using 2-column NavigationSplitView: sidebar | (content + optional inspector).
/// This avoids NavigationSplitViewVisibility bugs where .doubleColumn hides the sidebar.
struct MainShell: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 180, ideal: DS.sidebarWidth, max: 280)
        } detail: {
            HStack(spacing: 0) {
                VStack(spacing: 0) {
                    HeaderBar()
                    Divider()
                    contentView
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                if appState.selectedSection.showsInspector {
                    Divider()
                    InspectorPanel()
                        .frame(minWidth: 240, idealWidth: 280, maxWidth: 320)
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
        .toolbar(removing: .sidebarToggle)
    }

    @ViewBuilder
    private var contentView: some View {
        switch appState.selectedSection {
        case .today:    TodayView()
        case .apps:     AppsView()
        case .web:      WebView()
        case .history:  HistoryView()
        case .insights: InsightsView()
        case .settings: SettingsView()
        }
    }
}
