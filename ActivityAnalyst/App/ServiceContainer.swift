import Foundation

/// Shared service container providing access to core services.
/// Initialized once at app launch and accessible throughout the app.
@MainActor
final class ServiceContainer {
    static let shared = ServiceContainer()

    #if canImport(GRDB)
    let database: Database?
    let store: ActivityStore?
    #endif
    let captureEngine: CaptureEngine
    let sessionNormalizer: SessionNormalizer
    let eventDebouncer: EventDebouncer
    let categoryClassifier: CategoryClassifier
    let privacyFilter: PrivacyFilter
    let permissionManager: PermissionManager

    private init() {
        #if canImport(GRDB)
        do {
            database = try Database()
            store = ActivityStore(database: database!)
        } catch {
            print("ServiceContainer: Failed to initialize database: \(error)")
            database = nil
            store = nil
        }
        #endif

        captureEngine = CaptureEngine()
        sessionNormalizer = SessionNormalizer()
        eventDebouncer = EventDebouncer()
        categoryClassifier = CategoryClassifier()
        privacyFilter = PrivacyFilter()
        permissionManager = PermissionManager()
    }
}
