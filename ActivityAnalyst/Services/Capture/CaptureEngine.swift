import Foundation
import Combine
#if canImport(AppKit)
import AppKit
#endif

/// Coordinates all capture subsystems and manages the event pipeline.
/// Acts as the central hub that starts/stops monitors and routes events to processing.
@MainActor
final class CaptureEngine: ObservableObject {
    @Published private(set) var trackingState: TrackingState = .disabled
    @Published private(set) var currentApp: AppInfo?
    @Published private(set) var isIdle: Bool = false

    private let appMonitor: AppMonitor
    private let windowMonitor: WindowMonitor
    private let idleDetector: IdleDetector
    private let extensionBridge: ExtensionBridge

    private var eventBuffer: [ActivityEvent] = []
    private var flushTimer: Timer?
    private var cancellables = Set<AnyCancellable>()

    var onEventsReady: (([ActivityEvent]) -> Void)?

    init(
        appMonitor: AppMonitor = AppMonitor(),
        windowMonitor: WindowMonitor = WindowMonitor(),
        idleDetector: IdleDetector = IdleDetector(),
        extensionBridge: ExtensionBridge = ExtensionBridge()
    ) {
        self.appMonitor = appMonitor
        self.windowMonitor = windowMonitor
        self.idleDetector = idleDetector
        self.extensionBridge = extensionBridge
        setupBindings()
    }

    // MARK: - Lifecycle

    func start() {
        guard trackingState != .active else { return }

        appMonitor.startMonitoring()
        windowMonitor.startMonitoring()
        idleDetector.startMonitoring()
        extensionBridge.start()

        startFlushTimer()
        trackingState = .active
    }

    func stop() {
        appMonitor.stopMonitoring()
        windowMonitor.stopMonitoring()
        idleDetector.stopMonitoring()
        extensionBridge.stop()

        flushTimer?.invalidate()
        flushTimer = nil
        flushBuffer()
        trackingState = .disabled
    }

    func pause() {
        guard trackingState == .active else { return }
        appMonitor.stopMonitoring()
        windowMonitor.stopMonitoring()
        idleDetector.stopMonitoring()
        extensionBridge.stop()
        flushBuffer()
        trackingState = .paused
    }

    func resume() {
        guard trackingState == .paused else { return }
        appMonitor.startMonitoring()
        windowMonitor.startMonitoring()
        idleDetector.startMonitoring()
        extensionBridge.start()
        trackingState = .active
    }

    // MARK: - Event Pipeline

    private func setupBindings() {
        appMonitor.onAppEvent = { [weak self] event in
            if event.eventType == .appActivated,
               let bundleId = event.metadata?["bundleIdentifier"],
               let name = event.metadata?["name"] {
                self?.currentApp = AppInfo(id: event.appId, bundleIdentifier: bundleId, name: name)
            }
            self?.bufferEvent(event)
        }

        windowMonitor.onWindowEvent = { [weak self] event in
            self?.bufferEvent(event)
        }

        idleDetector.onIdleStateChanged = { [weak self] isIdle in
            guard let self = self else { return }
            self.isIdle = isIdle

            if isIdle {
                self.trackingState = .idle
                let event = ActivityEvent(
                    eventType: .idleStart,
                    appId: self.currentApp?.id ?? UUID(),
                    source: .native
                )
                self.bufferEvent(event)
            } else {
                self.trackingState = .active
                let event = ActivityEvent(
                    eventType: .idleEnd,
                    appId: self.currentApp?.id ?? UUID(),
                    source: .native
                )
                self.bufferEvent(event)
            }
        }

        extensionBridge.onBrowserEvent = { [weak self] event in
            self?.bufferEvent(event)
        }
    }

    private func bufferEvent(_ event: ActivityEvent) {
        eventBuffer.append(event)

        if eventBuffer.count >= TrackingRules.eventBufferSize {
            flushBuffer()
        }
    }

    private func startFlushTimer() {
        flushTimer = Timer.scheduledTimer(
            withTimeInterval: TrackingRules.eventFlushInterval,
            repeats: true
        ) { [weak self] _ in
            Task { @MainActor in
                self?.flushBuffer()
            }
        }
    }

    private func flushBuffer() {
        guard !eventBuffer.isEmpty else { return }
        let events = eventBuffer
        eventBuffer.removeAll()
        onEventsReady?(events)
    }
}

/// Lightweight struct for passing current app info around the capture layer.
struct AppInfo: Sendable {
    let id: UUID
    let bundleIdentifier: String
    let name: String
}
