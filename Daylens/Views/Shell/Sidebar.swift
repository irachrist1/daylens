import SwiftUI

/// Left navigation sidebar.
struct Sidebar: View {
    @Environment(AppState.self) private var appState

    private let mainSections: [SidebarSection] = [.today, .apps, .web]
    private let analysisSections: [SidebarSection] = [.history, .insights]

    var body: some View {
        @Bindable var state = appState

        List(selection: $state.selectedSection) {
            Section {
                ForEach(mainSections) { section in
                    Label(section.rawValue, systemImage: section.icon)
                        .tag(section)
                }
            }

            Section("Analysis") {
                ForEach(analysisSections) { section in
                    Label(section.rawValue, systemImage: section.icon)
                        .tag(section)
                }
            }

            Section {
                Label(SidebarSection.settings.rawValue, systemImage: SidebarSection.settings.icon)
                    .tag(SidebarSection.settings)
            }
        }
        .listStyle(.sidebar)
    }
}
