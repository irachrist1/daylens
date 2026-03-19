import SwiftUI

@main
struct ActivityAnalystApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .frame(
                    minWidth: Theme.minimumWindowWidth,
                    minHeight: Theme.minimumWindowHeight
                )
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified(showsTitle: false))
        .defaultSize(width: 1200, height: 800)
        .commands {
            CommandGroup(replacing: .newItem) {}

            CommandMenu("Navigation") {
                let visibleDestinations: [SidebarDestination] = [.today, .apps, .web, .insights, .history, .settings]
                ForEach(visibleDestinations) { dest in
                    Button(dest.displayName) {
                        appState.selectedDestination = dest
                    }
                    .keyboardShortcut(keyboardShortcut(for: dest))
                }
            }
        }

        Settings {
            SettingsView()
                .environmentObject(appState)
        }
    }

    private func keyboardShortcut(for destination: SidebarDestination) -> KeyboardShortcut {
        switch destination {
        case .today: return KeyboardShortcut("1", modifiers: .command)
        case .apps: return KeyboardShortcut("2", modifiers: .command)
        case .web, .browsers, .websites: return KeyboardShortcut("3", modifiers: .command)
        case .insights: return KeyboardShortcut("4", modifiers: .command)
        case .history: return KeyboardShortcut("5", modifiers: .command)
        case .settings: return KeyboardShortcut(",", modifiers: .command)
        }
    }
}
