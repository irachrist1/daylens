import AppKit
import SwiftUI

/// NSApplicationDelegate providing menu bar status item.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private weak var appState: AppState?
    private var refreshTimer: Timer?
    private var todaySummaryTask: Task<Void, Never>?
    private var cachedTodaySummary = MenuTodaySummary(activeTime: nil, topApps: [])

    func configure(with appState: AppState) {
        self.appState = appState
        refreshTodaySummary()
        rebuildMenu()
        configureMainWindowAppearance()

        // Observe focus session ticks to update menu bar title and controls
        appState.focusSession.onTick = { [weak self] in
            Task { @MainActor [weak self] in
                self?.updateMenuBarFocusTitle()
                self?.rebuildMenu()
            }
        }
    }

    private func updateMenuBarFocusTitle() {
        guard let appState, let button = statusItem?.button else { return }
        switch appState.focusSession.phase {
        case .focusing:
            let text = " \(appState.focusSession.formattedRemaining)"
            button.attributedTitle = NSAttributedString(string: text, attributes: [
                .font: NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .medium)
            ])
            button.imagePosition = .imageLeft
        case .onBreak:
            let text = " \(appState.focusSession.formattedBreakRemaining)"
            button.attributedTitle = NSAttributedString(string: text, attributes: [
                .font: NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .medium),
                .foregroundColor: NSColor(red: 0x68/255.0, green: 0xAE/255.0, blue: 0xFF/255.0, alpha: 1.0)
            ])
            button.imagePosition = .imageLeft
        case .idle:
            button.attributedTitle = NSAttributedString(string: "")
            button.title = ""
            button.imagePosition = .imageOnly
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupStatusItem()
        configureMainWindowAppearance()
        // Refresh menu content every 30 seconds
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.refreshTodaySummary()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        refreshTimer?.invalidate()
        refreshTimer = nil
        todaySummaryTask?.cancel()
        todaySummaryTask = nil
        if appState?.focusSession.isRunning == true {
            appState?.focusSession.stop()
        }
        appState?.permissionManager?.stopPolling()
        appState?.trackingCoordinator?.stopTracking()
        SyncUploader.shared.syncOnQuit()
        appState?.tearDownLifecycleHooks()
    }

    // MARK: - Menu Bar Status Item

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem?.button {
            let icon = NSImage(named: NSImage.applicationIconName)
            icon?.size = NSSize(width: 18, height: 18)
            button.image = icon
            button.imageScaling = .scaleProportionallyDown
        }

        rebuildMenu()
    }

    private func configureMainWindowAppearance() {
        DispatchQueue.main.async {
            guard let window = NSApplication.shared.windows.first else { return }
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.isMovableByWindowBackground = true
            // DS.surfaceContainer values — no asset catalog entry exists for this color,
            // so NSColor(named:) always returned nil, falling back to .windowBackgroundColor
            // and losing the transparent titlebar / rounded sidebar appearance in release builds.
            window.backgroundColor = NSColor(name: nil) { appearance in
                let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                return isDark
                    ? NSColor(srgbRed: 0x0d / 255.0, green: 0x1c / 255.0, blue: 0x2e / 255.0, alpha: 1.0)
                    : NSColor(srgbRed: 0xe8 / 255.0, green: 0xee / 255.0, blue: 0xf8 / 255.0, alpha: 1.0)
            }
        }
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        let trackingState = appState?.trackingCoordinator?.trackingState ?? .idle
        let todaySummary = cachedTodaySummary

        if let activeTime = todaySummary.activeTime {
            menu.addItem(makeInfoItem(
                title: "\(activeTime) active today",
                imageName: "clock",
                font: .systemFont(ofSize: 14, weight: .semibold)
            ))
        } else {
            menu.addItem(makeInfoItem(
                title: "No activity yet today",
                imageName: "clock",
                color: .secondaryLabelColor
            ))
        }

        if let statusContent = statusContent(for: trackingState) {
            menu.addItem(makeInfoItem(
                title: statusContent.title,
                imageName: statusContent.symbolName,
                color: .secondaryLabelColor
            ))
        }

        if !todaySummary.topApps.isEmpty {
            menu.addItem(NSMenuItem.separator())
            menu.addItem(makeSectionLabel("Top Apps"))

            for app in todaySummary.topApps {
                menu.addItem(makeInfoItem(
                    title: "\(app.appName) — \(app.formattedDuration)",
                    indentationLevel: 1
                ))
            }
        }

        menu.addItem(NSMenuItem.separator())

        // Focus controls
        if let session = appState?.focusSession {
            switch session.phase {
            case .focusing:
                let timerItem = makeInfoItem(
                    title: "⏱ Focus: \(session.formattedRemaining)",
                    font: .systemFont(ofSize: 13, weight: .semibold)
                )
                menu.addItem(timerItem)
                let endItem = NSMenuItem(title: "End Focus Session", action: #selector(endFocusSession), keyEquivalent: "")
                endItem.target = self
                endItem.image = menuSymbol(named: "stop.fill")
                menu.addItem(endItem)
            case .onBreak:
                let breakItem = makeInfoItem(
                    title: "☕ Break: \(session.formattedBreakRemaining)",
                    font: .systemFont(ofSize: 13, weight: .semibold)
                )
                menu.addItem(breakItem)
                let skipItem = NSMenuItem(title: "Skip Break", action: #selector(skipFocusBreak), keyEquivalent: "")
                skipItem.target = self
                skipItem.image = menuSymbol(named: "forward.fill")
                menu.addItem(skipItem)
            case .idle:
                let startItem = NSMenuItem(title: "Start Focus (\(session.targetMinutes)m)", action: #selector(startFocusSession), keyEquivalent: "")
                startItem.target = self
                startItem.image = menuSymbol(named: "timer")
                menu.addItem(startItem)
            }
            menu.addItem(NSMenuItem.separator())
        }

        // Pause / Resume
        if let coordinator = appState?.trackingCoordinator {
            if coordinator.trackingState == .tracking {
                let pauseItem = NSMenuItem(title: "Pause Tracking", action: #selector(pauseTracking), keyEquivalent: "")
                pauseItem.target = self
                pauseItem.image = menuSymbol(named: "pause.circle")
                menu.addItem(pauseItem)
            } else if coordinator.trackingState == .paused {
                let resumeItem = NSMenuItem(title: "Resume Tracking", action: #selector(resumeTracking), keyEquivalent: "")
                resumeItem.target = self
                resumeItem.image = menuSymbol(named: "play.circle")
                menu.addItem(resumeItem)
            }
        }

        let showItem = NSMenuItem(title: "Open Daylens", action: #selector(showMainWindow), keyEquivalent: "d")
        showItem.keyEquivalentModifierMask = [.command, .shift]
        showItem.target = self
        showItem.image = menuSymbol(named: "app")
        menu.addItem(showItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Quit Daylens", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quitItem.image = menuSymbol(named: "xmark.circle")
        menu.addItem(quitItem)

        self.statusItem?.menu = menu
    }

    private func refreshTodaySummary() {
        todaySummaryTask?.cancel()

        guard let db = appState?.database else {
            cachedTodaySummary = MenuTodaySummary(activeTime: nil, topApps: [])
            rebuildMenu()
            return
        }

        todaySummaryTask = Task { [weak self] in
            let mode = self?.appState?.usageMetricMode ?? .meaningful
            let summary = await Task.detached(priority: .utility) {
                let today = Calendar.current.startOfDay(for: Date())
                guard let summaries = try? db.appUsageSummaries(for: today, profile: mode), !summaries.isEmpty else {
                    return MenuTodaySummary(activeTime: nil, topApps: [])
                }

                let totalSeconds = summaries.reduce(0.0) { $0 + $1.totalDuration }
                let activeTime: String
                let hours = Int(totalSeconds) / 3600
                let minutes = (Int(totalSeconds) % 3600) / 60
                if hours > 0 {
                    activeTime = "\(hours)h \(minutes)m"
                } else if minutes > 0 {
                    activeTime = "\(minutes)m"
                } else {
                    activeTime = "\(Int(totalSeconds) % 60)s"
                }

                return MenuTodaySummary(
                    activeTime: activeTime,
                    topApps: Array(summaries.prefix(3))
                )
            }.value

            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard let self else { return }
                self.cachedTodaySummary = summary
                self.rebuildMenu()
            }
        }
    }

    private func statusContent(for trackingState: TrackingState) -> MenuStatusContent? {
        switch trackingState {
        case .tracking:
            return nil
        case .paused:
            return MenuStatusContent(title: "Tracking paused", symbolName: "pause.circle")
        case .idle:
            return MenuStatusContent(title: "Tracking unavailable", symbolName: "circle.dashed")
        case .error:
            return MenuStatusContent(title: "Tracking unavailable", symbolName: "exclamationmark.triangle")
        }
    }

    private func makeSectionLabel(_ title: String) -> NSMenuItem {
        makeInfoItem(
            title: title,
            font: .systemFont(ofSize: NSFont.smallSystemFontSize, weight: .semibold),
            color: .secondaryLabelColor
        )
    }

    private func makeInfoItem(
        title: String,
        imageName: String? = nil,
        font: NSFont = .menuFont(ofSize: 0),
        color: NSColor = .labelColor,
        indentationLevel: Int = 0
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        item.indentationLevel = indentationLevel
        item.attributedTitle = NSAttributedString(string: title, attributes: [
            .font: font,
            .foregroundColor: color
        ])
        if let imageName {
            item.image = menuSymbol(named: imageName)
        }
        return item
    }

    private func menuSymbol(named name: String) -> NSImage? {
        let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)
        image?.isTemplate = true
        return image
    }

    // MARK: - Actions

    @objc private func startFocusSession() {
        appState?.focusSession.start()
        rebuildMenu()
    }

    @objc private func endFocusSession() {
        appState?.focusSession.stop()
        rebuildMenu()
    }

    @objc private func skipFocusBreak() {
        appState?.focusSession.skipBreak()
        rebuildMenu()
    }

    @objc private func showMainWindow() {
        NSApplication.shared.activate(ignoringOtherApps: true)
        if let window = NSApplication.shared.windows.first {
            window.makeKeyAndOrderFront(nil)
        }
    }

    @objc private func pauseTracking() {
        appState?.trackingCoordinator?.stopTracking()
        rebuildMenu()
    }

    @objc private func resumeTracking() {
        appState?.trackingCoordinator?.startTracking()
        rebuildMenu()
    }
}

private struct MenuTodaySummary {
    let activeTime: String?
    let topApps: [AppUsageSummary]
}

private struct MenuStatusContent {
    let title: String
    let symbolName: String
}
