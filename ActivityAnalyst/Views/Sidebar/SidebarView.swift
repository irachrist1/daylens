import SwiftUI

/// Left sidebar navigation with section grouping.
/// Inspired by Arc's sidebar hierarchy and macOS HIG sidebar conventions.
struct SidebarView: View {
    @Binding var selection: SidebarDestination

    @State private var webExpanded = true

    var body: some View {
        List(selection: $selection) {
            Section("Activity") {
                SidebarItem(destination: .today)
                    .tag(SidebarDestination.today)

                SidebarItem(destination: .apps)
                    .tag(SidebarDestination.apps)

                DisclosureGroup(
                    isExpanded: $webExpanded,
                    content: {
                        SidebarItem(destination: .browsers)
                            .tag(SidebarDestination.browsers)
                        SidebarItem(destination: .websites)
                            .tag(SidebarDestination.websites)
                    },
                    label: {
                        SidebarItem(destination: .web)
                    }
                )
            }

            Section("Intelligence") {
                SidebarItem(destination: .insights)
                    .tag(SidebarDestination.insights)

                SidebarItem(destination: .history)
                    .tag(SidebarDestination.history)
            }

            Section {
                SidebarItem(destination: .settings)
                    .tag(SidebarDestination.settings)
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            SidebarFooter()
        }
    }
}

struct SidebarItem: View {
    let destination: SidebarDestination

    var body: some View {
        Label {
            Text(destination.displayName)
                .font(Theme.Typography.body)
        } icon: {
            Image(systemName: destination.sfSymbol)
                .font(.system(size: 14))
        }
    }
}

struct SidebarFooter: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(spacing: Theme.spacing8) {
            Divider()

            HStack(spacing: Theme.spacing8) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 6, height: 6)

                Text(statusText)
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Colors.secondaryText)

                Spacer()
            }
            .padding(.horizontal, Theme.spacing16)
            .padding(.bottom, Theme.spacing8)
        }
    }

    private var statusColor: Color {
        switch appState.trackingState {
        case .active: return .green
        case .paused: return .orange
        case .idle: return .yellow
        case .disabled: return .red
        }
    }

    private var statusText: String {
        switch appState.trackingState {
        case .active: return "Tracking active"
        case .paused: return "Tracking paused"
        case .idle: return "User idle"
        case .disabled: return "Tracking disabled"
        }
    }
}
