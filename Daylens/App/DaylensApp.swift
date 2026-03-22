import SwiftUI

@main
struct DaylensApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var appState = AppState()
    @State private var updateChecker = UpdateChecker()
    @State private var updateInstaller = UpdateInstaller()

    var body: some Scene {
        WindowGroup {
            ContentRouter()
                .environment(appState)
                .environment(updateChecker)
                .environment(updateInstaller)
                .frame(minWidth: 900, minHeight: 600)
                .onAppear {
                    appState.initialize()
                    appDelegate.configure(with: appState)
                    updateChecker.startPolling()
                }
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified(showsTitle: false))
        .defaultSize(width: 1200, height: 800)
        .commands {
            DaylensCommands(appState: appState)
        }

        Settings {
            SettingsView()
                .environment(appState)
                .environment(updateChecker)
                .environment(updateInstaller)
        }
    }
}

/// Routes between onboarding and main app based on completion state.
struct ContentRouter: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        if appState.hasCompletedOnboarding {
            MainShell()
        } else {
            OnboardingFlow()
        }
    }
}

/// Global keyboard shortcuts for the app.
struct DaylensCommands: Commands {
    let appState: AppState

    var body: some Commands {
        CommandGroup(after: .toolbar) {
            Button("Previous Day") {
                appState.goToPreviousDay()
            }
            .keyboardShortcut("[", modifiers: .command)

            Button("Next Day") {
                appState.goToNextDay()
            }
            .keyboardShortcut("]", modifiers: .command)

            Button("Go to Today") {
                appState.goToToday()
            }
            .keyboardShortcut("t", modifiers: .command)
        }

        CommandGroup(replacing: .sidebar) {}
    }
}
