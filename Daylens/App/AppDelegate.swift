import AppKit
import SwiftUI

/// NSApplicationDelegate providing menu bar status item and global keyboard shortcuts.
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

        updateMenu()
    }

    func updateMenu() {
        let menu = NSMenu()

        let isTracking = appState?.isTrackingActive ?? false

        // Status
        let statusItem = NSMenuItem(title: isTracking ? "Tracking Active" : "Tracking Paused", action: nil, keyEquivalent: "")
        statusItem.image = NSImage(systemSymbolName: isTracking ? "circle.fill" : "pause.circle.fill", accessibilityDescription: nil)
        statusItem.image?.isTemplate = true
        menu.addItem(statusItem)

        menu.addItem(NSMenuItem.separator())

        // Toggle tracking
        let toggleTitle = isTracking ? "Pause Tracking" : "Resume Tracking"
        let toggleItem = NSMenuItem(title: toggleTitle, action: #selector(toggleTracking), keyEquivalent: "p")
        toggleItem.keyEquivalentModifierMask = [.command, .shift]
        toggleItem.target = self
        menu.addItem(toggleItem)

        // Show window
        let showItem = NSMenuItem(title: "Show Daylens", action: #selector(showMainWindow), keyEquivalent: "d")
        showItem.keyEquivalentModifierMask = [.command, .shift]
        showItem.target = self
        menu.addItem(showItem)

        menu.addItem(NSMenuItem.separator())

        // Quit
        let quitItem = NSMenuItem(title: "Quit Daylens", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quitItem)

        self.statusItem?.menu = menu
    }

    @objc private func toggleTracking() {
        appState?.toggleTracking()
        updateMenu()
    }

    @objc private func showMainWindow() {
        NSApplication.shared.activate(ignoringOtherApps: true)
        if let window = NSApplication.shared.windows.first {
            window.makeKeyAndOrderFront(nil)
        }
    }
}
