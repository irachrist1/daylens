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
                ForEach(SidebarDestination.allCases) { dest in
                    Button(dest.displayName) {
                        appState.selectedDestination = dest
                    }
                    .keyboardShortcut(keyboardShortcut(for: dest))
                }
            }

            CommandGroup(after: .toolbar) {
                Button("Command Bar") {
                    appState.showCommandBar.toggle()
                }
                .keyboardShortcut("k", modifiers: .command)

                Button("Toggle Inspector") {
                    appState.showInspector.toggle()
                }
                .keyboardShortcut("i", modifiers: [.command, .option])
            }

            CommandMenu("Tracking") {
                Button(appState.isTracking ? "Pause Tracking" : "Resume Tracking") {
                    appState.toggleTracking()
                }
                .keyboardShortcut("t", modifiers: [.command, .shift])
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
        case .web: return KeyboardShortcut("3", modifiers: .command)
        case .browsers: return KeyboardShortcut("4", modifiers: .command)
        case .websites: return KeyboardShortcut("5", modifiers: .command)
        case .insights: return KeyboardShortcut("6", modifiers: .command)
        case .history: return KeyboardShortcut("7", modifiers: .command)
        case .settings: return KeyboardShortcut(",", modifiers: .command)
        }
    }
}
