import Foundation
#if canImport(AppKit)
import AppKit
#endif

/// Monitors frontmost app changes and app lifecycle events using NSWorkspace.
/// Event-driven: no polling. Responds to system notifications.
final class AppMonitor {
    var onAppEvent: ((ActivityEvent) -> Void)?

    private var currentFrontmostBundleId: String?
    private var activationTimestamp: Date?

    #if canImport(AppKit)
    private var observers: [NSObjectProtocol] = []
    #endif

    func startMonitoring() {
        #if canImport(AppKit)
        let workspace = NSWorkspace.shared
        let center = workspace.notificationCenter

        let activateObserver = center.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleAppActivated(notification)
        }

        let deactivateObserver = center.addObserver(
            forName: NSWorkspace.didDeactivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleAppDeactivated(notification)
        }

        let launchObserver = center.addObserver(
            forName: NSWorkspace.didLaunchApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleAppLaunched(notification)
        }

        let terminateObserver = center.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleAppTerminated(notification)
        }

        observers = [activateObserver, deactivateObserver, launchObserver, terminateObserver]

        if let frontmost = workspace.frontmostApplication {
            emitActivation(for: frontmost)
        }
        #endif
    }

    func stopMonitoring() {
        #if canImport(AppKit)
        let center = NSWorkspace.shared.notificationCenter
        for observer in observers {
            center.removeObserver(observer)
        }
        observers.removeAll()

        if currentFrontmostBundleId != nil {
            emitDeactivationForCurrent()
        }
        #endif
    }

    // MARK: - Notification Handlers

    #if canImport(AppKit)
    private func handleAppActivated(_ notification: Notification) {
        guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else {
            return
        }

        if currentFrontmostBundleId != nil {
            emitDeactivationForCurrent()
        }

        emitActivation(for: app)
    }

    private func handleAppDeactivated(_ notification: Notification) {
        guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              app.bundleIdentifier == currentFrontmostBundleId else {
            return
        }
        emitDeactivationForCurrent()
    }

    private func handleAppLaunched(_ notification: Notification) {
        guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              let bundleId = app.bundleIdentifier else {
            return
        }

        let event = ActivityEvent(
            eventType: .appLaunched,
            appId: appUUID(for: bundleId),
            source: .native,
            metadata: ["bundleIdentifier": bundleId, "name": app.localizedName ?? bundleId]
        )
        onAppEvent?(event)
    }

    private func handleAppTerminated(_ notification: Notification) {
        guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              let bundleId = app.bundleIdentifier else {
            return
        }

        let event = ActivityEvent(
            eventType: .appTerminated,
            appId: appUUID(for: bundleId),
            source: .native,
            metadata: ["bundleIdentifier": bundleId, "name": app.localizedName ?? bundleId]
        )
        onAppEvent?(event)
    }

    private func emitActivation(for app: NSRunningApplication) {
        guard let bundleId = app.bundleIdentifier else { return }

        currentFrontmostBundleId = bundleId
        activationTimestamp = Date()

        var metadata: [String: String] = [
            "bundleIdentifier": bundleId,
            "name": app.localizedName ?? bundleId,
        ]

        if BrowserRecord.isBrowser(bundleId) {
            metadata["isBrowser"] = "true"
        }

        let event = ActivityEvent(
            eventType: .appActivated,
            appId: appUUID(for: bundleId),
            browserId: BrowserRecord.isBrowser(bundleId) ? browserUUID(for: bundleId) : nil,
            source: .native,
            metadata: metadata
        )
        onAppEvent?(event)
    }

    private func emitDeactivationForCurrent() {
        guard let bundleId = currentFrontmostBundleId else { return }

        let event = ActivityEvent(
            eventType: .appDeactivated,
            appId: appUUID(for: bundleId),
            browserId: BrowserRecord.isBrowser(bundleId) ? browserUUID(for: bundleId) : nil,
            source: .native,
            metadata: [
                "bundleIdentifier": bundleId,
                "activeDuration": activationTimestamp.map {
                    String(Date().timeIntervalSince($0))
                } ?? "0",
            ]
        )
        onAppEvent?(event)

        currentFrontmostBundleId = nil
        activationTimestamp = nil
    }
    #endif

    /// Deterministic UUID from bundle identifier for consistent app identification
    /// before the database assigns a permanent UUID.
    private func appUUID(for bundleId: String) -> UUID {
        UUID(uuidString: UUID(uuid: UUID.namespaceDNS(bundleId)).uuidString)
            ?? UUID()
    }

    private func browserUUID(for bundleId: String) -> UUID {
        UUID(uuidString: UUID(uuid: UUID.namespaceDNS("browser.\(bundleId)")).uuidString)
            ?? UUID()
    }
}

extension UUID {
    /// Simple deterministic UUID v5-like generation from a name string.
    static func namespaceDNS(_ name: String) -> uuid_t {
        var hasher = name.utf8.reduce(into: (0 as UInt64, 0 as UInt64)) { partial, byte in
            partial.0 = partial.0 &* 31 &+ UInt64(byte)
            partial.1 = partial.1 &* 37 &+ UInt64(byte)
        }
        return (
            UInt8(truncatingIfNeeded: hasher.0 >> 56),
            UInt8(truncatingIfNeeded: hasher.0 >> 48),
            UInt8(truncatingIfNeeded: hasher.0 >> 40),
            UInt8(truncatingIfNeeded: hasher.0 >> 32),
            UInt8(truncatingIfNeeded: hasher.0 >> 24),
            UInt8(truncatingIfNeeded: hasher.0 >> 16),
            UInt8(truncatingIfNeeded: hasher.0 >> 8),
            UInt8(truncatingIfNeeded: hasher.0),
            UInt8(truncatingIfNeeded: hasher.1 >> 56),
            UInt8(truncatingIfNeeded: hasher.1 >> 48),
            UInt8(truncatingIfNeeded: hasher.1 >> 40),
            UInt8(truncatingIfNeeded: hasher.1 >> 32),
            UInt8(truncatingIfNeeded: hasher.1 >> 24),
            UInt8(truncatingIfNeeded: hasher.1 >> 16),
            UInt8(truncatingIfNeeded: hasher.1 >> 8),
            UInt8(truncatingIfNeeded: hasher.1)
        )
    }
}
