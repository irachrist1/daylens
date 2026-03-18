import SwiftUI
import AppKit

@main
struct DayLensApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    private let env = AppEnvironment()

    var body: some Scene {
        WindowGroup("DayLens") {
            ContentView()
                .environment(\.appEnvironment, env)
                .frame(minWidth: 900, minHeight: 600)
        }
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(after: .windowArrangement) {
                Button("Show Command Bar") {
                    env.isCommandBarVisible.toggle()
                }
                .keyboardShortcut("k", modifiers: .command)
            }
        }

        // Preferences window
        Settings {
            SettingsView()
                .environment(\.appEnvironment, env)
        }
    }
}
