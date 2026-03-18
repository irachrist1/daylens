import SwiftUI

/// Root three-column layout: Sidebar | Center feed | Right inspector
struct ContentView: View {
    @Environment(\.appEnvironment) private var env

    var body: some View {
        NavigationSplitView(
            columnVisibility: .constant(.all)
        ) {
            SidebarView()
        } content: {
            centerView
        } detail: {
            InspectorView()
        }
        .navigationSplitViewStyle(.balanced)
        .overlay(alignment: .top) {
            if env.isCommandBarVisible {
                CommandBarView()
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(100)
            }
        }
        .animation(.spring(duration: 0.2), value: env.isCommandBarVisible)
    }

    @ViewBuilder
    private var centerView: some View {
        switch env.selectedSection {
        case .today:    TodayView()
        case .apps:     AppsView()
        case .web:      WebsitesView()
        case .browsers: BrowsersView()
        case .insights: InsightsView()
        case .history:  HistoryView()
        case .settings: SettingsView()
        }
    }
}

// MARK: - Command bar

struct CommandBarView: View {
    @Environment(\.appEnvironment) private var env
    @State private var query = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                TextField("Jump to app, site, or ask a question…", text: $query)
                    .textFieldStyle(.plain)
                    .font(DLTypography.bodyLarge)
                    .onSubmit { handleSubmit() }
                Button("Cancel") { env.isCommandBarVisible = false }
                    .buttonStyle(.plain)
                    .foregroundColor(.secondary)
                    .font(DLTypography.bodyMedium)
            }
            .padding(14)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            .shadow(color: .black.opacity(0.15), radius: 20, y: 8)
            .padding(.horizontal, 80)
            .padding(.top, 60)
        }
        .onExitCommand { env.isCommandBarVisible = false }
        .background(Color.clear)
    }

    private func handleSubmit() {
        env.isCommandBarVisible = false
        // If it looks like a question, route to insights/chat
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.hasPrefix("how") || q.hasPrefix("what") || q.hasPrefix("which") || q.hasPrefix("when") {
            env.selectedSection = .insights
        }
        query = ""
    }
}
