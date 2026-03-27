import SwiftUI
import Observation
import OSLog

@Observable
final class AppState {
    private let logger = Logger(subsystem: "com.daylens.app", category: "AppState")
    private let userDefaults: UserDefaults
    private let syncUploader = SyncUploader.shared
    private var dayChangeObserver: NSObjectProtocol?

    // MARK: - Navigation
    var selectedSection: SidebarSection = .today
    var selectedDate: Date = Calendar.current.startOfDay(for: Date())

    // MARK: - Onboarding
    var hasCompletedOnboarding: Bool

    // MARK: - ViewModels (session-scoped)
    var insightsViewModel = InsightsViewModel()
    var focusSession = FocusSessionManager()
    var usageMetricMode: UsageMetricMode {
        didSet { persistUsageMetricMode() }
    }

    // MARK: - Services
    var database: AppDatabase!
    var trackingCoordinator: TrackingCoordinator!
    var aiService: AIService!
    var permissionManager: PermissionManager!
    var preferencesService: PreferencesService?
    private var hasInitialized = false
    private var isRunningTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }

    // MARK: - Appearance
    var colorScheme: ColorScheme? {
        didSet { persistColorScheme() }
    }

    init() {
        self.userDefaults = .standard
        self.hasCompletedOnboarding = userDefaults.bool(forKey: Constants.DefaultsKey.hasCompletedOnboarding)
        self.colorScheme = Self.loadColorScheme(from: .standard)
        self.usageMetricMode = Self.loadUsageMetricMode(from: .standard)
    }

    init(userDefaults: UserDefaults) {
        self.userDefaults = userDefaults
        self.hasCompletedOnboarding = userDefaults.bool(forKey: Constants.DefaultsKey.hasCompletedOnboarding)
        self.colorScheme = Self.loadColorScheme(from: userDefaults)
        self.usageMetricMode = Self.loadUsageMetricMode(from: userDefaults)
    }

    private static func loadColorScheme(from defaults: UserDefaults) -> ColorScheme? {
        guard let raw = defaults.string(forKey: "colorScheme") else { return nil }
        return raw == "dark" ? .dark : .light
    }

    private static func loadUsageMetricMode(from defaults: UserDefaults) -> UsageMetricMode {
        guard let raw = defaults.string(forKey: Constants.DefaultsKey.usageMetricMode),
              let mode = UsageMetricMode(rawValue: raw) else {
            return .meaningful
        }
        return mode
    }

    private func persistColorScheme() {
        if let v = colorScheme {
            userDefaults.set(v == .dark ? "dark" : "light", forKey: "colorScheme")
        } else {
            userDefaults.removeObject(forKey: "colorScheme")
        }
    }

    private func persistUsageMetricMode() {
        userDefaults.set(usageMetricMode.rawValue, forKey: Constants.DefaultsKey.usageMetricMode)
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
        aiService = AIService()
        let blockLabelCache = BlockLabelCache()
        blockLabelCache.pruneExpiredLabels()
        trackingCoordinator = TrackingCoordinator(
            database: database,
            permissionManager: permissionManager,
            aiService: aiService,
            blockLabelCache: blockLabelCache
        )
        logger.info("Daylens services initialized")

        if hasCompletedOnboarding, !isRunningTests {
            logger.info("Tracking starts on launch because onboarding is already complete")
            trackingCoordinator.startTracking()
            if syncUploader.isLinked {
                logger.info("Sync starts on launch because a workspace is already linked")
                syncUploader.startSync()
                let prefs = PreferencesService()
                preferencesService = prefs
                prefs.load()
            }
            installDayChangeObserverIfNeeded()
        } else if hasCompletedOnboarding {
            logger.debug("Skipping launch-time tracking because tests are running")
        }
    }

    // MARK: - Color Scheme Preference

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

    func handleDayChange() {
        let today = Calendar.current.startOfDay(for: Date())
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: today)

        if let yesterday, Calendar.current.isDate(selectedDate, inSameDayAs: yesterday) {
            selectedDate = today
        }

        logger.info("Detected a local day rollover; finalizing the previous day for sync")
        syncUploader.finalizePreviousDay()
    }

    /// Called after a workspace is successfully linked so preferences sync starts immediately.
    func workspaceDidLink() {
        if preferencesService == nil {
            let prefs = PreferencesService()
            preferencesService = prefs
            prefs.load()
        }
    }

    func tearDownLifecycleHooks() {
        if let dayChangeObserver {
            NotificationCenter.default.removeObserver(dayChangeObserver)
            self.dayChangeObserver = nil
        }
    }

    private func installDayChangeObserverIfNeeded() {
        guard dayChangeObserver == nil else { return }

        dayChangeObserver = NotificationCenter.default.addObserver(
            forName: .NSCalendarDayChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.handleDayChange()
        }
    }
}

enum SidebarSection: String, CaseIterable, Identifiable {
    case today = "Today"
    case focus = "Focus"
    case history = "History"
    case reports = "Reports"
    case apps = "Apps"
    case insights = "Insights"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .today: "sun.max"
        case .focus: "timer"
        case .history: "calendar"
        case .reports: "doc.text.magnifyingglass"
        case .apps: "square.grid.2x2"
        case .insights: "sparkles"
        case .settings: "gearshape"
        }
    }

    var showsDateNavigation: Bool {
        switch self {
        case .today, .apps: return true
        case .focus, .history, .reports, .insights, .settings: return false
        }
    }

    var showsInspector: Bool {
        false
    }
}
