import AppKit
import Foundation

/// Observes NSWorkspace notifications to detect app launches, terminations,
/// and frontmost-app changes. Feeds raw ActivityEvents to SessionNormalizer.
///
/// Runs entirely on the main actor to avoid races with NSWorkspace callbacks.
@MainActor
final class AppMonitor {
    private let normalizer: SessionNormalizer
    private let settings: UserSettings
    private var observations: [NSObjectProtocol] = []
    private(set) var isRunning = false

    init(normalizer: SessionNormalizer, settings: UserSettings) {
        self.normalizer = normalizer
        self.settings = settings
    }

    // MARK: - Lifecycle

    func start() {
        guard !isRunning else { return }
        isRunning = true

        let nc = NSWorkspace.shared.notificationCenter

        observations.append(
            nc.addObserver(
                forName: NSWorkspace.didActivateApplicationNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in
                guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
                else { return }
                Task { @MainActor in
                    self?.handleActivation(app)
                }
            }
        )

        observations.append(
            nc.addObserver(
                forName: NSWorkspace.didDeactivateApplicationNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in
                guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
                else { return }
                Task { @MainActor in
                    self?.handleDeactivation(app)
                }
            }
        )

        observations.append(
            nc.addObserver(
                forName: NSWorkspace.didLaunchApplicationNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in
                guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
                else { return }
                Task { @MainActor in
                    self?.handleLaunch(app)
                }
            }
        )

        observations.append(
            nc.addObserver(
                forName: NSWorkspace.didTerminateApplicationNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in
                guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
                else { return }
                Task { @MainActor in
                    self?.handleTermination(app)
                }
            }
        )
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        observations.forEach { NSWorkspace.shared.notificationCenter.removeObserver($0) }
        observations.removeAll()
    }

    // MARK: - Handlers

    private func handleActivation(_ app: NSRunningApplication) {
        guard !settings.isTrackingPaused else { return }
        guard let bundleId = app.bundleIdentifier else { return }
        let event = ActivityEvent(
            eventType: .appActivated,
            appBundleId: bundleId,
            appName: app.localizedName ?? bundleId,
            source: .nsworkspace
        )
        normalizer.process(event)
    }

    private func handleDeactivation(_ app: NSRunningApplication) {
        guard !settings.isTrackingPaused else { return }
        guard let bundleId = app.bundleIdentifier else { return }
        let event = ActivityEvent(
            eventType: .appDeactivated,
            appBundleId: bundleId,
            appName: app.localizedName ?? bundleId,
            source: .nsworkspace
        )
        normalizer.process(event)
    }

    private func handleLaunch(_ app: NSRunningApplication) {
        guard !settings.isTrackingPaused else { return }
        guard let bundleId = app.bundleIdentifier else { return }
        let event = ActivityEvent(
            eventType: .appLaunched,
            appBundleId: bundleId,
            appName: app.localizedName ?? bundleId,
            source: .nsworkspace
        )
        normalizer.process(event)
    }

    private func handleTermination(_ app: NSRunningApplication) {
        guard let bundleId = app.bundleIdentifier else { return }
        let event = ActivityEvent(
            eventType: .appTerminated,
            appBundleId: bundleId,
            appName: app.localizedName ?? bundleId,
            source: .nsworkspace
        )
        normalizer.process(event)
    }
}
