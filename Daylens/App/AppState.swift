import SwiftUI
import Observation

@Observable
final class AppState {
    // MARK: - Navigation
    var selectedSection: SidebarSection = .today
    var selectedDate: Date = Calendar.current.startOfDay(for: Date())
    var isTrackingActive: Bool = true

    // MARK: - Onboarding
    var hasCompletedOnboarding: Bool {
        get { UserDefaults.standard.bool(forKey: "hasCompletedOnboarding") }
        set { UserDefaults.standard.set(newValue, forKey: "hasCompletedOnboarding") }
    }

    // MARK: - Services
    var database: AppDatabase!
    var trackingCoordinator: TrackingCoordinator!
    var aiService: AIService!
    var permissionManager: PermissionManager!

    // MARK: - Initialization
    func initialize() {
        database = AppDatabase.shared
        permissionManager = PermissionManager()
        trackingCoordinator = TrackingCoordinator(database: database, permissionManager: permissionManager)
        aiService = AIService()

        if hasCompletedOnboarding && isTrackingActive {
            trackingCoordinator.startTracking()
        }
    }

    // MARK: - Date Navigation
    var isToday: Bool {
        Calendar.current.isDateInToday(selectedDate)
    }

    func goToToday() {
        selectedDate = Calendar.current.startOfDay(for: Date())
    }

    func goToPreviousDay() {
        selectedDate = Calendar.current.date(byAdding: .day, value: -1, to: selectedDate) ?? selectedDate
    }

    func goToNextDay() {
        guard !isToday else { return }
        selectedDate = Calendar.current.date(byAdding: .day, value: 1, to: selectedDate) ?? selectedDate
    }

    func toggleTracking() {
        isTrackingActive.toggle()
        if isTrackingActive {
            trackingCoordinator.startTracking()
        } else {
            trackingCoordinator.stopTracking()
        }
    }
}

enum SidebarSection: String, CaseIterable, Identifiable {
    case today = "Today"
    case apps = "Apps"
    case browsers = "Browsers"
    case websites = "Websites"
    case history = "History"
    case insights = "Insights"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .today: "sun.max"
        case .apps: "square.grid.2x2"
        case .browsers: "globe"
        case .websites: "link"
        case .history: "clock.arrow.circlepath"
        case .insights: "sparkles"
        case .settings: "gearshape"
        }
    }
}
