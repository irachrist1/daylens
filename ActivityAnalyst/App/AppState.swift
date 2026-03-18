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

    private let container = ServiceContainer.shared

    init() {
        hasCompletedOnboarding = UserDefaults.standard.bool(
            forKey: AppConstants.UserDefaultsKeys.hasCompletedOnboarding
        )
        showInspector = UserDefaults.standard.object(forKey: AppConstants.UserDefaultsKeys.showInspector) != nil
            ? UserDefaults.standard.bool(forKey: AppConstants.UserDefaultsKeys.showInspector)
            : true

        NotificationCenter.default.addObserver(
            forName: AppConstants.NotificationNames.trackingStateChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.toggleTracking()
        }

        if hasCompletedOnboarding {
            startTracking()
        }
    }

    func toggleTracking() {
        if isTracking {
            container.captureEngine.pause()
            isTracking = false
            trackingState = .paused
        } else {
            container.captureEngine.resume()
            isTracking = true
            trackingState = .active
        }
    }

    func startTracking() {
        container.captureEngine.start()
        isTracking = true
        trackingState = .active
    }

    func stopTracking() {
        container.captureEngine.stop()
        isTracking = false
        trackingState = .disabled
    }

    func completeOnboarding() {
        hasCompletedOnboarding = true
        UserDefaults.standard.set(true, forKey: AppConstants.UserDefaultsKeys.hasCompletedOnboarding)
    }
}
