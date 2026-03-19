import SwiftUI
import Observation

@Observable
final class AppState {
    // MARK: - Navigation
    var selectedSection: SidebarSection = .today
    var selectedDate: Date = Calendar.current.startOfDay(for: Date())

    // MARK: - Onboarding
    var hasCompletedOnboarding: Bool = UserDefaults.standard.bool(forKey: "hasCompletedOnboarding") {
        didSet { UserDefaults.standard.set(hasCompletedOnboarding, forKey: "hasCompletedOnboarding") }
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

        if hasCompletedOnboarding {
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
}

enum SidebarSection: String, CaseIterable, Identifiable {
    case today = "Today"
    case apps = "Apps"
    case web = "Web"
    case history = "History"
    case insights = "Insights"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .today: "sun.max"
        case .apps: "square.grid.2x2"
        case .web: "globe"
        case .history: "clock.arrow.circlepath"
        case .insights: "sparkles"
        case .settings: "gearshape"
        }
    }

    var showsDateNavigation: Bool {
        switch self {
        case .today, .apps, .web, .history: return true
        case .insights, .settings: return false
        }
    }

    var showsInspector: Bool {
        switch self {
        case .today, .apps: return true
        case .web, .history, .insights, .settings: return false
        }
    }
}
