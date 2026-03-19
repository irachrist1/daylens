import SwiftUI

/// Left sidebar navigation with section grouping.
/// Inspired by Arc's sidebar hierarchy and macOS HIG sidebar conventions.
struct SidebarView: View {
    @Binding var selection: SidebarDestination

    var body: some View {
        List(selection: $selection) {
            Section("Activity") {
                SidebarItem(destination: .today)
                    .tag(SidebarDestination.today)

                SidebarItem(destination: .apps)
                    .tag(SidebarDestination.apps)

                SidebarItem(destination: .web)
                    .tag(SidebarDestination.web)
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

