import SwiftUI

/// Left navigation sidebar.
struct Sidebar: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState

        List(selection: $state.selectedSection) {
            ForEach(SidebarSection.allCases) { section in
                Label(section.rawValue, systemImage: section.icon)
                    .tag(section)
            }
        }
        .listStyle(.sidebar)
        .environment(\.defaultMinListRowHeight, DS.sidebarItemHeight)
    }
}
