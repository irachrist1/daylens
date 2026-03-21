import SwiftUI
import Observation
import OSLog

@Observable
final class AppState {
    private let logger = Logger(subsystem: "com.daylens.app", category: "AppState")
    private let userDefaults: UserDefaults

    // MARK: - Navigation
    var selectedSection: SidebarSection = .today
    var selectedDate: Date = Calendar.current.startOfDay(for: Date())

    // MARK: - Onboarding
    var hasCompletedOnboarding: Bool

    // MARK: - ViewModels (session-scoped)
    var insightsViewModel = InsightsViewModel()
    var focusSession = FocusSessionManager()

    // MARK: - Services
    var database: AppDatabase!
    var trackingCoordinator: TrackingCoordinator!
    var aiService: AIService!
    var permissionManager: PermissionManager!
    private var hasInitialized = false
    private var isRunningTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }

    init() {
        self.userDefaults = .standard
        self.hasCompletedOnboarding = userDefaults.bool(forKey: Constants.DefaultsKey.hasCompletedOnboarding)
    }

    init(userDefaults: UserDefaults) {
        self.userDefaults = userDefaults
        self.hasCompletedOnboarding = userDefaults.bool(forKey: Constants.DefaultsKey.hasCompletedOnboarding)
    }

    /// Mark onboarding complete and persist immediately.
    func completeOnboarding(name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            userDefaults.set(trimmed, forKey: Constants.DefaultsKey.userName)
        }
        userDefaults.set(true, forKey: Constants.DefaultsKey.hasCompletedOnboarding)
        hasCompletedOnboarding = true
    }

    // MARK: - Initialization
    func initialize() {
        guard !hasInitialized else {
            logger.debug("AppState.initialize skipped because services are already configured")
            return
        }

        hasInitialized = true
        database = AppDatabase.shared
        focusSession = FocusSessionManager(database: database)
        permissionManager = PermissionManager()
        trackingCoordinator = TrackingCoordinator(database: database, permissionManager: permissionManager)
        aiService = AIService()
        logger.info("Daylens services initialized")

        if hasCompletedOnboarding, !isRunningTests {
            logger.info("Tracking starts on launch because onboarding is already complete")
            trackingCoordinator.startTracking()
        } else if hasCompletedOnboarding {
            logger.debug("Skipping launch-time tracking because tests are running")
        }
    }

    // MARK: - Color Scheme Preference

    // Color scheme preference (nil = follow system)
    var colorScheme: ColorScheme? {
        get {
            guard let raw = userDefaults.string(forKey: "colorScheme") else { return nil }
            return raw == "dark" ? .dark : .light
        }
        set {
            if let v = newValue {
                userDefaults.set(v == .dark ? "dark" : "light", forKey: "colorScheme")
            } else {
                userDefaults.removeObject(forKey: "colorScheme")
            }
        }
    }

    var userName: String { userDefaults.string(forKey: Constants.DefaultsKey.userName) ?? "User" }

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
    case focus = "Focus"
    case history = "History"
    case apps = "Apps"
    case insights = "Insights"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .today: "sun.max"
        case .focus: "timer"
        case .history: "calendar"
        case .apps: "square.grid.2x2"
        case .insights: "sparkles"
        case .settings: "gearshape"
        }
    }

    var showsDateNavigation: Bool {
        switch self {
        case .today, .apps: return true
        case .focus, .history, .insights, .settings: return false
        }
    }

    var showsInspector: Bool {
        false
    }
}
