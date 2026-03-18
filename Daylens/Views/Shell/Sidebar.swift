import SwiftUI

/// Left navigation sidebar.
struct Sidebar: View {
    @Environment(AppState.self) private var appState

    private let mainSections: [SidebarSection] = [.today, .apps, .browsers, .websites]
    private let analysisSections: [SidebarSection] = [.history, .insights]

    var body: some View {
        @Bindable var state = appState

        List(selection: $state.selectedSection) {
            Section {
                ForEach(mainSections) { section in
                    sidebarItem(section)
                }
            }

            Section("Analysis") {
                ForEach(analysisSections) { section in
                    sidebarItem(section)
                }
            }

            Section {
                sidebarItem(.settings)
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            trackingStatusBar
        }
    }

    private func sidebarItem(_ section: SidebarSection) -> some View {
        Label {
            Text(section.rawValue)
        } icon: {
            Image(systemName: section.icon)
                .foregroundStyle(section == appState.selectedSection ? .accent : .secondary)
        }
        .tag(section)
    }

    private var trackingStatusBar: some View {
        HStack(spacing: DS.space8) {
            Circle()
                .fill(appState.isTrackingActive ? Color.green : Color.orange)
                .frame(width: 8, height: 8)

            Text(appState.isTrackingActive ? "Tracking" : "Paused")
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer()

            Button {
                appState.toggleTracking()
            } label: {
                Image(systemName: appState.isTrackingActive ? "pause.fill" : "play.fill")
                    .font(.caption)
            }
            .buttonStyle(.borderless)
            .help(appState.isTrackingActive ? "Pause tracking" : "Resume tracking")
        }
        .padding(.horizontal, DS.space16)
        .padding(.vertical, DS.space8)
        .background(.bar)
    }
}
