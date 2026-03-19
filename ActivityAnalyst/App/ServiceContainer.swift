import Foundation

/// Shared service container providing access to core services.
/// Initialized once at app launch and accessible throughout the app.
/// Wires the full pipeline: capture → debounce → normalize → persist → summarize.
@MainActor
final class ServiceContainer: ObservableObject {
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
    @Published private(set) var aiAnalyst: AIAnalyst?
    #if canImport(GRDB)
    private(set) var conversationManager: ConversationManager?
    #endif

    private var pipelineTask: Task<Void, Never>?

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

        reloadAIServices()
        wirePipeline()

        NotificationCenter.default.addObserver(
            forName: AppConstants.NotificationNames.apiKeyChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.reloadAIServices()
            }
        }
    }

    /// Recreates AI services with the current API key. Called on init and when key changes.
    func reloadAIServices() {
        let apiKey = ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"]
            ?? UserDefaults.standard.string(forKey: "anthropic_api_key")
            ?? ""

        if !apiKey.isEmpty {
            aiAnalyst = AIAnalyst(apiKey: apiKey)
        } else {
            aiAnalyst = nil
        }

        #if canImport(GRDB)
        if let analyst = aiAnalyst, let store = store {
            conversationManager = ConversationManager(aiAnalyst: analyst, store: store)
        } else {
            conversationManager = nil
        }
        #endif
    }

    /// Wires the event pipeline: CaptureEngine → PrivacyFilter → EventDebouncer → SessionNormalizer → ActivityStore
    private func wirePipeline() {
        #if canImport(GRDB)
        guard let store = store else {
            print("ServiceContainer: No store available, pipeline not wired")
            return
        }

        let debouncer = eventDebouncer
        let normalizer = sessionNormalizer
        let classifier = categoryClassifier
        let filter = privacyFilter

        captureEngine.onEventsReady = { [weak self] rawEvents in
            guard let self = self else { return }

            let previousTask = self.pipelineTask
            self.pipelineTask = Task {
                await previousTask?.value
                do {
                    let filtered = filter.filterBatch(rawEvents)
                    let debounced = debouncer.processBatch(filtered)

                    guard !debounced.isEmpty else { return }

                    var resolvedEvents: [ActivityEvent] = []

                    for var event in debounced {
                        if let bundleId = event.metadata?["bundleIdentifier"],
                           let name = event.metadata?["name"] {
                            let app = try await store.findOrCreateApp(bundleIdentifier: bundleId, name: name)
                            event.appId = app.id

                            if BrowserRecord.isBrowser(bundleId) {
                                let browserName = BrowserRecord.browserName(for: bundleId) ?? name
                                let browser = try await store.findOrCreateBrowser(bundleIdentifier: bundleId, name: browserName)
                                event.browserId = browser.id
                            }

                            if let domain = event.metadata?["inferredDomain"] ?? event.metadata?["domain"],
                               !domain.isEmpty {
                                let website = try await store.findOrCreateWebsite(domain: domain)
                                event.websiteId = website.id
                            }
                        }

                        resolvedEvents.append(event)
                    }

                    try await store.insertEvents(resolvedEvents)

                    let sessions = normalizer.normalize(events: resolvedEvents)
                    if !sessions.isEmpty {
                        let apps = try await store.fetchAllApps()
                        let appsById = Dictionary(uniqueKeysWithValues: apps.map { ($0.id, $0) })
                        let websites = try await store.fetchAllWebsites()
                        let websitesById = Dictionary(uniqueKeysWithValues: websites.map { ($0.id, $0) })

                        var classified = classifier.classifySessions(sessions, apps: appsById, websites: websitesById)
                        classified = classified.map { session in
                            var s = session
                            if let bundleId = resolvedEvents.first(where: { $0.appId == session.appId })?.metadata?["bundleIdentifier"],
                               let app = apps.first(where: { $0.bundleIdentifier == bundleId }) {
                                s.appId = app.id
                            }
                            return s
                        }
                        try await store.insertSessions(classified)

                        await self.rebuildTodaySummary(store: store, apps: appsById, websites: websitesById)
                    }

                    NotificationCenter.default.post(name: AppConstants.NotificationNames.newSessionRecorded, object: nil)
                } catch {
                    print("ServiceContainer pipeline error: \(error)")
                }
            }
        }
        #endif
    }

    #if canImport(GRDB)
    private func rebuildTodaySummary(store: ActivityStore, apps: [UUID: AppRecord], websites: [UUID: WebsiteRecord]) async {
        do {
            let start = DateFormatters.startOfDay()
            let end = DateFormatters.endOfDay()
            let sessions = try await store.fetchSessions(from: start, to: end, significantOnly: false)
            let browsers = try await store.fetchAllBrowsers()
            let browsersById = Dictionary(uniqueKeysWithValues: browsers.map { ($0.id, $0) })

            let builder = DailySummaryBuilder(
                date: start,
                sessions: sessions,
                apps: apps,
                browsers: browsersById,
                websites: websites
            )
            let summary = builder.build()
            try await store.upsertDailySummary(summary)
        } catch {
            print("ServiceContainer: Failed to rebuild daily summary: \(error)")
        }
    }
    #endif

    var hasStore: Bool {
        #if canImport(GRDB)
        return store != nil
        #else
        return false
        #endif
    }

    var hasAI: Bool {
        aiAnalyst != nil
    }
}
