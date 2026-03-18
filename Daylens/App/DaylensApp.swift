import SwiftUI

@main
struct DaylensApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentRouter()
                .environment(appState)
                .frame(minWidth: 900, minHeight: 600)
                .onAppear {
                    appState.initialize()
                }
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified(showsTitle: false))
        .defaultSize(width: 1200, height: 800)

        Settings {
            SettingsView()
                .environment(appState)
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
