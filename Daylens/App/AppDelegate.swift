import AppKit
import SwiftUI

/// NSApplicationDelegate providing menu bar status item.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private weak var appState: AppState?

    func configure(with appState: AppState) {
        self.appState = appState
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupStatusItem()
    }

    // MARK: - Menu Bar Status Item

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem?.button {
            button.image = NSImage(systemSymbolName: "sun.max.fill", accessibilityDescription: "Daylens")
            button.image?.size = NSSize(width: 16, height: 16)
        }

        let menu = NSMenu()

        let statusMenuItem = NSMenuItem(title: "Daylens is tracking", action: nil, keyEquivalent: "")
        statusMenuItem.image = NSImage(systemSymbolName: "circle.fill", accessibilityDescription: nil)
        statusMenuItem.image?.isTemplate = true
        menu.addItem(statusMenuItem)

        menu.addItem(NSMenuItem.separator())

        let showItem = NSMenuItem(title: "Show Daylens", action: #selector(showMainWindow), keyEquivalent: "d")
        showItem.keyEquivalentModifierMask = [.command, .shift]
        showItem.target = self
        menu.addItem(showItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Quit Daylens", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quitItem)

        self.statusItem?.menu = menu
    }

    @objc private func showMainWindow() {
        NSApplication.shared.activate(ignoringOtherApps: true)
        if let window = NSApplication.shared.windows.first {
            window.makeKeyAndOrderFront(nil)
        }
    }
}
