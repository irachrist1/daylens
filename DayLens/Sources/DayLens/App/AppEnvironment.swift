import Foundation
import SwiftUI

/// Central dependency container, injected via SwiftUI environment.
/// All major services live here and can be accessed from any view.
@Observable
final class AppEnvironment {
    // Data layer
    let database: AppDatabase
    let activityRepo: ActivityRepository
    let insightRepo: InsightRepository
    let aggregator: DailyAggregator

    // AI layer
    let anthropicClient: AnthropicClient
    let summaryGenerator: DailySummaryGenerator
    let analyst: ConversationalAnalyst

    // Settings (observable, persisted)
    let settings: UserSettings

    // Capture layer
    let appMonitor: AppMonitor
    let idleDetector: IdleDetector

    // Navigation / UI state
    var selectedSection: SidebarSection = .today
    var selectedDateKey: String = AppSession.makeDateKey(from: Date().timeIntervalSince1970)
    var inspectorItem: InspectorItem? = nil
    var isCommandBarVisible: Bool = false

    init(database: AppDatabase = .shared) {
        self.database = database
        self.activityRepo = ActivityRepository(db: database)
        self.insightRepo = InsightRepository(db: database)
        self.aggregator = DailyAggregator(db: database)

        let settings = UserSettings()
        self.settings = settings

        self.anthropicClient = AnthropicClient(settings: settings)
        self.summaryGenerator = DailySummaryGenerator(
            aggregator: DailyAggregator(db: database),
            insightRepo: InsightRepository(db: database),
            client: AnthropicClient(settings: settings)
        )
        self.analyst = ConversationalAnalyst(
            aggregator: DailyAggregator(db: database),
            insightRepo: InsightRepository(db: database),
            client: AnthropicClient(settings: settings)
        )

        // Capture services — share the same activity repo
        let sessionNormalizer = SessionNormalizer(
            activityRepo: ActivityRepository(db: database),
            settings: settings
        )
        self.appMonitor = AppMonitor(normalizer: sessionNormalizer, settings: settings)
        self.idleDetector = IdleDetector(settings: settings, onIdle: {
            sessionNormalizer.handleIdleStart()
        }, onResume: {
            sessionNormalizer.handleIdleEnd()
        })
    }

    /// Start all background capture services.
    func startCapture() {
        guard !settings.isTrackingPaused else { return }
        appMonitor.start()
        idleDetector.start()
    }

    /// Pause all capture services.
    func pauseCapture() {
        appMonitor.stop()
        idleDetector.stop()
        try? activityRepo.closeAllOpenSessions()
    }

    /// Load settings from database.
    func loadSettings() {
        guard let rows = try? database.read({ db in
            try UserSettingRow.fetchAll(db)
        }) else { return }
        settings.load(from: rows)
    }

    /// Persist settings to database.
    func saveSettings() {
        let rows = settings.toRows()
        try? database.write { db in
            for row in rows {
                try row.save(db)
            }
        }
    }
}

// MARK: - Navigation types

enum SidebarSection: String, CaseIterable, Identifiable {
    case today     = "Today"
    case apps      = "Apps"
    case web       = "Web"
    case browsers  = "Browsers"
    case insights  = "Insights"
    case history   = "History"
    case settings  = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .today:    return "sun.max"
        case .apps:     return "square.grid.2x2"
        case .web:      return "globe"
        case .browsers: return "safari"
        case .insights: return "sparkles"
        case .history:  return "clock"
        case .settings: return "gearshape"
        }
    }
}

enum InspectorItem: Identifiable {
    case app(AppUsageSummary)
    case website(WebsiteUsageSummary)
    case browser(BrowserUsageSummary)
    case session(AppSession)

    var id: String {
        switch self {
        case .app(let s):     return "app-\(s.id)"
        case .website(let w): return "web-\(w.id)"
        case .browser(let b): return "browser-\(b.id)"
        case .session(let s): return "session-\(s.id)"
        }
    }
}

// MARK: - Environment key

private struct AppEnvironmentKey: EnvironmentKey {
    static let defaultValue: AppEnvironment = AppEnvironment()
}

extension EnvironmentValues {
    var appEnvironment: AppEnvironment {
        get { self[AppEnvironmentKey.self] }
        set { self[AppEnvironmentKey.self] = newValue }
    }
}
