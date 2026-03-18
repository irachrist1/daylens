import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var env: AppEnvironment?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenuBarItem()
        // env is injected via the shared singleton after launch
        let sharedEnv = AppEnvironment()
        self.env = sharedEnv
        sharedEnv.loadSettings()
        sharedEnv.startCapture()
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Close all open sessions cleanly so no session leaks across restarts
        env?.pauseCapture()
        env?.saveSettings()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            NSApp.windows.first?.makeKeyAndOrderFront(nil)
        }
        return true
    }

    // MARK: - Menu bar

    private func setupMenuBarItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        if let button = statusItem?.button {
            button.image = NSImage(systemSymbolName: "clock.fill", accessibilityDescription: "DayLens")
            button.image?.isTemplate = true
            button.action = #selector(statusItemClicked)
            button.target = self
        }
    }

    @objc private func statusItemClicked() {
        NSApp.windows.first?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
