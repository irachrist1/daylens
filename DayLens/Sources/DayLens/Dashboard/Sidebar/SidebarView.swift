import SwiftUI

struct SidebarView: View {
    @Environment(\.appEnvironment) private var env

    var body: some View {
        List(selection: Binding(
            get: { env.selectedSection },
            set: { if let s = $0 { env.selectedSection = s } }
        )) {
            // Top-level nav
            ForEach(mainSections) { section in
                Label(section.rawValue, systemImage: section.icon)
                    .tag(section)
                    .font(DLTypography.sidebarItem)
            }

            Divider()

            Section("LIBRARY") {
                ForEach(librarySections) { section in
                    Label(section.rawValue, systemImage: section.icon)
                        .tag(section)
                        .font(DLTypography.sidebarItem)
                }
            }
        }
        .listStyle(.sidebar)
        .frame(minWidth: 190, idealWidth: 210)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    env.isCommandBarVisible.toggle()
                } label: {
                    Image(systemName: "magnifyingglass")
                }
                .help("Open command bar (⌘K)")
            }
        }
        .navigationTitle("DayLens")
        .safeAreaInset(edge: .bottom) {
            trackingStatusBadge
        }
    }

    // MARK: - Section groups

    private let mainSections: [SidebarSection] = [
        .today, .apps, .web, .browsers, .insights
    ]
    private let librarySections: [SidebarSection] = [
        .history, .settings
    ]

    // MARK: - Tracking status indicator

    private var trackingStatusBadge: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(env.settings.isTrackingPaused ? Color.dlWarningAmber : Color.dlFocusGreen)
                .frame(width: 7, height: 7)
            Text(env.settings.isTrackingPaused ? "Paused" : "Tracking")
                .font(DLTypography.caption)
                .foregroundColor(.secondary)
            Spacer()
            if env.settings.isTrackingPaused {
                Button("Resume") {
                    env.settings.isTrackingPaused = false
                    env.startCapture()
                    env.saveSettings()
                }
                .font(DLTypography.caption)
                .buttonStyle(.borderless)
                .foregroundColor(Color.dlAccent)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(NSColor.controlBackgroundColor))
    }
}
