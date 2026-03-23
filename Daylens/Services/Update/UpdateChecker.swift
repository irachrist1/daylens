import Foundation
import Observation
import OSLog

@MainActor
@Observable
final class UpdateChecker {
    @ObservationIgnored private let logger = Logger(subsystem: "com.daylens.app", category: "UpdateChecker")
    @ObservationIgnored private let userDefaults: UserDefaults
    @ObservationIgnored private var pollingTask: Task<Void, Never>?
    @ObservationIgnored private var isChecking = false
    @ObservationIgnored private var dismissedVersion: String?

    private static let latestReleaseURL = URL(string: "https://api.github.com/repos/irachrist1/daylens/releases/latest")!
    private static let allReleasesURL = URL(string: "https://api.github.com/repos/irachrist1/daylens/releases")!
    private static let skippedVersionKey = "daylens_skipped_version"

    var updateAvailable = false
    var latestVersion: String?
    var releaseNotes: String?
    var downloadURL: URL?
    var releasePageURL: URL?

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults

        #if DEBUG
        // Launch argument -forceUpdateBanner YES to test banner layout
        // (add in Xcode scheme → Arguments → Arguments Passed On Launch)
        if ProcessInfo.processInfo.arguments.contains("-forceUpdateBanner") {
            updateAvailable = true
            latestVersion = "99.0.0"
            releaseNotes = "Debug: forced update banner for layout testing."
            downloadURL = URL(string: "https://example.com/fake.dmg")
        }
        #endif
    }

    deinit {
        pollingTask?.cancel()
    }

    func startPolling() {
        guard pollingTask == nil else { return }

        pollingTask = Task { [weak self] in
            guard let self else { return }

            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled else { return }
            await self.checkForUpdates()

            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_800_000_000_000)
                guard !Task.isCancelled else { break }
                await self.checkForUpdates()
            }
        }
    }

    func dismiss() {
        dismissedVersion = latestVersion
        updateAvailable = false
    }

    func skipCurrentVersion() {
        guard let latestVersion else { return }
        userDefaults.set(latestVersion, forKey: Self.skippedVersionKey)
        dismissedVersion = nil
        updateAvailable = false
        logger.info("Skipped update prompt for version \(latestVersion, privacy: .public)")
    }

    private func checkForUpdates() async {
        guard !isChecking else { return }
        isChecking = true
        defer { isChecking = false }

        do {
            let request = makeRequest()
            let client = ReleaseDownloadClient(logger: logger)
            let (data, response) = try await client.fetch(request)

            guard (200...299).contains(response.statusCode) else {
                logger.error("Latest release check returned HTTP \(response.statusCode, privacy: .public)")
                return
            }

            let release = try JSONDecoder().decode(GitHubRelease.self, from: data)
            apply(release)
        } catch {
            logger.error("Latest release check failed: \(error.localizedDescription, privacy: .private)")
        }
    }

    private func apply(_ release: GitHubRelease) {
        let remoteVersion = normalizedVersionString(release.tagName)
        let localVersion = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"

        releasePageURL = release.htmlURL
        latestVersion = remoteVersion
        releaseNotes = release.body?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        downloadURL = release.assets.first(where: \.isDMG)?.browserDownloadURL

        guard let downloadURL else {
            updateAvailable = false
            logger.notice("Latest GitHub release \(remoteVersion, privacy: .public) has no DMG asset")
            return
        }

        self.downloadURL = downloadURL

        guard isNewerVersion(remoteVersion, than: localVersion) else {
            updateAvailable = false
            return
        }

        let skippedVersion = userDefaults.string(forKey: Self.skippedVersionKey)
        let shouldSuppress = skippedVersion == remoteVersion || dismissedVersion == remoteVersion

        if shouldSuppress {
            updateAvailable = false
            logger.debug("Suppressing banner for version \(remoteVersion, privacy: .public)")
        } else {
            updateAvailable = true
            logger.info("Update available: \(remoteVersion, privacy: .public)")

            // Fetch aggregated release notes from all skipped versions
            Task { [weak self] in
                await self?.fetchAggregatedReleaseNotes(currentVersion: localVersion)
            }
        }
    }

    private func fetchAggregatedReleaseNotes(currentVersion: String) async {
        do {
            var request = URLRequest(url: Self.allReleasesURL)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 30
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")

            let client = ReleaseDownloadClient(logger: logger)
            let (data, response) = try await client.fetch(request)

            guard (200...299).contains(response.statusCode) else {
                logger.error("All releases check returned HTTP \(response.statusCode, privacy: .public)")
                return
            }

            let allReleases = try JSONDecoder().decode([GitHubRelease].self, from: data)

            // Filter to only releases newer than the current version
            let newerReleases = allReleases.filter { release in
                let version = normalizedVersionString(release.tagName)
                return isNewerVersion(version, than: currentVersion)
            }

            // Sort oldest-first so notes read chronologically
            let sorted = newerReleases.sorted { a, b in
                let vA = normalizedVersionString(a.tagName)
                let vB = normalizedVersionString(b.tagName)
                return isNewerVersion(vB, than: vA)
            }

            guard sorted.count > 1 else {
                // Only one (or zero) newer release — keep the single latest notes already set
                return
            }

            // Build aggregated notes with version headers
            let aggregated = sorted.compactMap { release -> String? in
                let version = normalizedVersionString(release.tagName)
                let body = release.body?.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let body, !body.isEmpty else { return nil }
                return "### v\(version)\n\(body)"
            }.joined(separator: "\n\n")

            if !aggregated.isEmpty {
                releaseNotes = aggregated
                logger.info("Aggregated release notes from \(sorted.count, privacy: .public) versions")
            }
        } catch {
            // Fall back to single latest release notes (already set) — don't break the update flow
            logger.error("Aggregated release notes fetch failed: \(error.localizedDescription, privacy: .private)")
        }
    }

    private func makeRequest() -> URLRequest {
        var request = URLRequest(url: Self.latestReleaseURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 30
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        return request
    }

    private var userAgent: String {
        let bundleID = Bundle.main.bundleIdentifier ?? "com.daylens.app"
        let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"
        return "\(bundleID)/\(version)"
    }
}

func isNewerVersion(_ remote: String, than local: String) -> Bool {
    let remoteComponents = versionComponents(from: remote)
    let localComponents = versionComponents(from: local)
    let maxCount = max(remoteComponents.count, localComponents.count)

    for index in 0..<maxCount {
        let remoteValue = index < remoteComponents.count ? remoteComponents[index] : 0
        let localValue = index < localComponents.count ? localComponents[index] : 0

        if remoteValue != localValue {
            return remoteValue > localValue
        }
    }

    return false
}

private func normalizedVersionString(_ version: String) -> String {
    let trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.lowercased().hasPrefix("v") {
        return String(trimmed.dropFirst())
    }
    return trimmed
}

private func versionComponents(from version: String) -> [Int] {
    normalizedVersionString(version)
        .split(separator: ".")
        .map { component in
            Int(component.prefix { $0.isNumber }) ?? 0
        }
}

private struct GitHubRelease: Decodable {
    struct Asset: Decodable {
        let name: String
        let browserDownloadURL: URL

        var isDMG: Bool {
            name.lowercased().hasSuffix(".dmg")
        }

        private enum CodingKeys: String, CodingKey {
            case name
            case browserDownloadURL = "browser_download_url"
        }
    }

    let tagName: String
    let htmlURL: URL
    let body: String?
    let assets: [Asset]

    private enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case htmlURL = "html_url"
        case body
        case assets
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

private final class ReleaseDownloadClient: NSObject, URLSessionDownloadDelegate {
    private let logger: Logger
    private let lock = NSLock()

    private var continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    private var activeTask: URLSessionDownloadTask?
    private var downloadedData: Data?
    private var downloadedResponse: HTTPURLResponse?

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: "\(Bundle.main.bundleIdentifier ?? "com.daylens.app").update-checker.\(UUID().uuidString)")
        configuration.isDiscretionary = false
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 120
        configuration.sessionSendsLaunchEvents = false

        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.name = "Daylens.UpdateChecker.Download"
        return URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }()

    init(logger: Logger) {
        self.logger = logger
        super.init()
    }

    deinit {
        session.invalidateAndCancel()
    }

    func fetch(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                self.continuation = continuation
                let task = session.downloadTask(with: request)
                activeTask = task
                lock.unlock()
                task.resume()
            }
        } onCancel: {
            self.lock.lock()
            let task = self.activeTask
            self.lock.unlock()
            task?.cancel()
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        do {
            let data = try Data(contentsOf: location)
            let response = try httpResponse(for: downloadTask)

            lock.lock()
            downloadedData = data
            downloadedResponse = response
            lock.unlock()
        } catch {
            finish(with: .failure(error))
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            finish(with: .failure(error))
            return
        }

        lock.lock()
        let data = downloadedData
        let response = downloadedResponse
        lock.unlock()

        guard let data, let response else {
            finish(with: .failure(UpdateCheckerNetworkError.missingDownloadPayload))
            return
        }

        finish(with: .success((data, response)))
    }

    private func httpResponse(for task: URLSessionTask) throws -> HTTPURLResponse {
        guard let response = task.response as? HTTPURLResponse else {
            throw UpdateCheckerNetworkError.invalidResponse
        }
        return response
    }

    private func finish(with result: Result<(Data, HTTPURLResponse), Error>) {
        lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        activeTask = nil
        downloadedData = nil
        downloadedResponse = nil
        lock.unlock()

        if continuation == nil {
            logger.debug("Ignoring duplicate UpdateChecker session completion")
            return
        }

        session.finishTasksAndInvalidate()
        continuation?.resume(with: result)
    }
}

private enum UpdateCheckerNetworkError: LocalizedError {
    case invalidResponse
    case missingDownloadPayload

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid update-check response."
        case .missingDownloadPayload:
            return "Update-check payload was empty."
        }
    }
}
