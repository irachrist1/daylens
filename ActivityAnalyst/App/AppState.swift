import SwiftUI

/// Global application state shared across the view hierarchy.
@MainActor
final class AppState: ObservableObject {
    @Published var selectedDestination: SidebarDestination = .today
    @Published var showInspector: Bool = true
    @Published var showCommandBar: Bool = false
    @Published var isTracking: Bool = false
    @Published var hasCompletedOnboarding: Bool = false

    @Published var trackingState: TrackingState = .disabled

    private var captureEngine: CaptureEngine?
    private var sessionNormalizer: SessionNormalizer?

    init() {
        hasCompletedOnboarding = UserDefaults.standard.bool(
            forKey: AppConstants.UserDefaultsKeys.hasCompletedOnboarding
        )
        showInspector = UserDefaults.standard.bool(
            forKey: AppConstants.UserDefaultsKeys.showInspector
        )
    }

    func setupServices(captureEngine: CaptureEngine, normalizer: SessionNormalizer) {
        self.captureEngine = captureEngine
        self.sessionNormalizer = normalizer
    }

    func toggleTracking() {
        if isTracking {
            captureEngine?.pause()
            isTracking = false
            trackingState = .paused
        } else {
            captureEngine?.resume()
            isTracking = true
            trackingState = .active
        }
    }

    func startTracking() {
        captureEngine?.start()
        isTracking = true
        trackingState = .active
    }

    func stopTracking() {
        captureEngine?.stop()
        isTracking = false
        trackingState = .disabled
    }

    func completeOnboarding() {
        hasCompletedOnboarding = true
        UserDefaults.standard.set(true, forKey: AppConstants.UserDefaultsKeys.hasCompletedOnboarding)
    }
}
