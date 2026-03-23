import AppKit
import Foundation
import Observation
import OSLog

@MainActor
@Observable
final class UpdateInstaller {
    enum Phase: Equatable {
        case idle
        case downloading
        case installing
        case failed(String)
        case manualInstallRequired(String)
    }

    @ObservationIgnored private let logger = Logger(subsystem: "com.daylens.app", category: "UpdateInstaller")

    var phase: Phase = .idle
    var downloadProgress: Double = 0

    @ObservationIgnored private var manualInstallTargetURL: URL?

    var isBusy: Bool {
        switch phase {
        case .downloading, .installing:
            return true
        case .idle, .failed, .manualInstallRequired:
            return false
        }
    }

    func downloadAndInstall(from url: URL) async throws {
        guard !isBusy else { return }

        phase = .downloading
        downloadProgress = 0
        manualInstallTargetURL = nil

        do {
            var request = URLRequest(url: url)
            request.timeoutInterval = 300
            request.setValue(updateUserAgent, forHTTPHeaderField: "User-Agent")

            let downloader = DMGDownloadClient(logger: logger) { [weak self] progress in
                Task { @MainActor in
                    guard let self else { return }
                    self.downloadProgress = progress
                }
            }

            let downloadedDMG = try await downloader.download(request)
            phase = .installing
            downloadProgress = max(downloadProgress, 1.0)

            let result = try await UpdateInstallCoordinator.installDownloadedDMG(
                downloadedDMG,
                logger: logger
            )

            if let backupURL = result.backupURL {
                logger.info("Previous app bundle left at \(backupURL.path, privacy: .private)")
            }

            UpdateInstallCoordinator.cleanupDownloadedDMG(downloadedDMG, logger: logger)

            try await UpdateInstallCoordinator.relaunchApp(at: result.installedAppURL, logger: logger)
        } catch let error as UpdateInstallerError {
            switch error {
            case .manualInstallRequired(let targetURL, let message):
                manualInstallTargetURL = targetURL
                phase = .manualInstallRequired(message)
            default:
                phase = .failed(error.userFacingMessage)
            }
            throw error
        } catch {
            phase = .failed("Download failed — try again")
            logger.error("Auto-update failed: \(error.localizedDescription, privacy: .private)")
            throw error
        }
    }

    func resetFailure() {
        if case .failed = phase {
            phase = .idle
            downloadProgress = 0
        }
    }

    func revealManualInstall() {
        guard let manualInstallTargetURL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([manualInstallTargetURL])
    }

    private var updateUserAgent: String {
        let bundleID = Bundle.main.bundleIdentifier ?? "com.daylens.app"
        let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"
        return "\(bundleID)/\(version)"
    }
}

private enum UpdateInstallerError: LocalizedError {
    case invalidHTTPResponse
    case unexpectedStatusCode(Int)
    case missingDownloadedFile
    case mountedAppNotFound
    case mountFailed(String)
    case detachFailed(String)
    case commandFailed(String)
    case manualInstallRequired(URL, String)

    var errorDescription: String? {
        switch self {
        case .invalidHTTPResponse:
            return "The update download returned an invalid response."
        case .unexpectedStatusCode(let code):
            return "The update download returned HTTP \(code)."
        case .missingDownloadedFile:
            return "The downloaded update file was unavailable."
        case .mountedAppNotFound:
            return "The mounted update disk image did not contain an app bundle."
        case .mountFailed(let output):
            return "Failed to mount the update image: \(output)"
        case .detachFailed(let output):
            return "Failed to detach the update image: \(output)"
        case .commandFailed(let output):
            return "Update command failed: \(output)"
        case .manualInstallRequired(_, let message):
            return message
        }
    }

    var userFacingMessage: String {
        switch self {
        case .manualInstallRequired(_, let message):
            return message
        default:
            return "Download failed — try again"
        }
    }
}

private final class DMGDownloadClient: NSObject, URLSessionDownloadDelegate {
    private let logger: Logger
    private let progressHandler: @Sendable (Double) -> Void
    private let lock = NSLock()

    private var continuation: CheckedContinuation<URL, Error>?
    private var activeTask: URLSessionDownloadTask?
    private var downloadedFileURL: URL?
    private var response: HTTPURLResponse?

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 300
        configuration.timeoutIntervalForResource = 3_600

        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.name = "Daylens.UpdateInstaller.Download"
        return URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }()

    init(logger: Logger, progressHandler: @escaping @Sendable (Double) -> Void) {
        self.logger = logger
        self.progressHandler = progressHandler
        super.init()
    }

    deinit {
        session.invalidateAndCancel()
    }

    func download(_ request: URLRequest) async throws -> URL {
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

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        progressHandler(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        do {
            let response = try httpResponse(for: downloadTask)
            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("DaylensUpdate-\(UUID().uuidString)")
                .appendingPathExtension("dmg")

            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }

            try FileManager.default.moveItem(at: location, to: destination)

            lock.lock()
            downloadedFileURL = destination
            self.response = response
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
        let downloadedFileURL = self.downloadedFileURL
        let response = self.response
        lock.unlock()

        guard let downloadedFileURL else {
            finish(with: .failure(UpdateInstallerError.missingDownloadedFile))
            return
        }

        guard let response else {
            finish(with: .failure(UpdateInstallerError.invalidHTTPResponse))
            return
        }

        guard (200...299).contains(response.statusCode) else {
            try? FileManager.default.removeItem(at: downloadedFileURL)
            finish(with: .failure(UpdateInstallerError.unexpectedStatusCode(response.statusCode)))
            return
        }

        finish(with: .success(downloadedFileURL))
    }

    private func httpResponse(for task: URLSessionTask) throws -> HTTPURLResponse {
        guard let response = task.response as? HTTPURLResponse else {
            throw UpdateInstallerError.invalidHTTPResponse
        }
        return response
    }

    private func finish(with result: Result<URL, Error>) {
        lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        activeTask = nil
        downloadedFileURL = nil
        response = nil
        lock.unlock()

        if continuation == nil {
            logger.debug("Ignoring duplicate UpdateInstaller session completion")
            return
        }

        session.finishTasksAndInvalidate()
        continuation?.resume(with: result)
    }
}

private enum UpdateInstallCoordinator {
    struct InstallResult {
        let installedAppURL: URL
        let backupURL: URL?
    }

    static func installDownloadedDMG(_ downloadedDMG: URL, logger: Logger) async throws -> InstallResult {
        try await Task.detached(priority: .utility) {
            let fileManager = FileManager.default
            let mountPoint = URL(fileURLWithPath: "/tmp/DaylensUpdate-\(UUID().uuidString)", isDirectory: true)
            try fileManager.createDirectory(at: mountPoint, withIntermediateDirectories: true)

            var shouldDetach = false

            do {
                try attachDMG(at: downloadedDMG, mountPoint: mountPoint, logger: logger)
                shouldDetach = true

                let mountedAppURL = try findAppBundle(in: mountPoint)
                let currentAppURL = URL(fileURLWithPath: Bundle.main.bundlePath)
                let stagingURL = uniqueSiblingURL(for: currentAppURL, suffix: ".update")
                let backupURL = uniqueSiblingURL(for: currentAppURL, suffix: ".old")

                do {
                    try fileManager.copyItem(at: mountedAppURL, to: stagingURL)
                } catch {
                    if isPermissionError(error) {
                        await MainActor.run {
                            NSWorkspace.shared.activateFileViewerSelecting([mountedAppURL])
                        }
                        throw UpdateInstallerError.manualInstallRequired(
                            mountedAppURL,
                            "Automatic install needs permission. The mounted update is open in Finder."
                        )
                    }
                    throw error
                }

                // Remove quarantine xattr — copied files from a DMG inherit it,
                // and Gatekeeper blocks ad-hoc signed apps that are quarantined.
                _ = try? runCommand(
                    executable: "/usr/bin/xattr",
                    arguments: ["-dr", "com.apple.quarantine", stagingURL.path]
                )

                do {
                    try fileManager.moveItem(at: currentAppURL, to: backupURL)
                } catch {
                    try? fileManager.removeItem(at: stagingURL)
                    throw error
                }

                do {
                    try fileManager.moveItem(at: stagingURL, to: currentAppURL)
                } catch {
                    try? fileManager.moveItem(at: backupURL, to: currentAppURL)
                    throw error
                }

                // Clean up backup — the old version is no longer needed
                try? fileManager.removeItem(at: backupURL)

                do {
                    try detachDMG(at: mountPoint, force: false, logger: logger)
                } catch {
                    logger.error("Failed to detach mounted update image: \(error.localizedDescription, privacy: .private)")
                }
                shouldDetach = false
                try? fileManager.removeItem(at: mountPoint)

                return InstallResult(installedAppURL: currentAppURL, backupURL: nil)
            } catch let error as UpdateInstallerError {
                if shouldDetach {
                    try? detachDMG(at: mountPoint, force: true, logger: logger)
                }
                try? fileManager.removeItem(at: mountPoint)
                throw error
            } catch {
                if shouldDetach {
                    try? detachDMG(at: mountPoint, force: true, logger: logger)
                }
                try? fileManager.removeItem(at: mountPoint)
                throw error
            }
        }.value
    }

    static func cleanupDownloadedDMG(_ downloadedDMG: URL, logger: Logger) {
        do {
            try FileManager.default.removeItem(at: downloadedDMG)
        } catch {
            logger.error("Failed to remove downloaded DMG: \(error.localizedDescription, privacy: .private)")
        }
    }

    static func relaunchApp(at appURL: URL, logger: Logger) async throws {
        try await Task.detached(priority: .utility) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            process.arguments = [appURL.path]

            try process.run()
            process.waitUntilExit()

            guard process.terminationStatus == 0 else {
                throw UpdateInstallerError.commandFailed("open exited with status \(process.terminationStatus)")
            }
        }.value

        logger.info("Relaunching app from \(appURL.path, privacy: .private)")
        await MainActor.run {
            NSApplication.shared.terminate(nil)
        }
    }

    private static func attachDMG(at dmgURL: URL, mountPoint: URL, logger: Logger) throws {
        let output = try runCommand(
            executable: "/usr/bin/hdiutil",
            arguments: ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint.path, dmgURL.path]
        )
        logger.info("Mounted update image at \(mountPoint.path, privacy: .private) with output: \(output, privacy: .private)")
    }

    private static func detachDMG(at mountPoint: URL, force: Bool, logger: Logger) throws {
        var arguments = ["detach", mountPoint.path]
        if force {
            arguments.append("-force")
        }

        do {
            let output = try runCommand(executable: "/usr/bin/hdiutil", arguments: arguments)
            logger.info("Detached update image at \(mountPoint.path, privacy: .private) with output: \(output, privacy: .private)")
        } catch {
            let description = error.localizedDescription
            if force {
                throw UpdateInstallerError.detachFailed(description)
            }
            throw error
        }
    }

    private static func findAppBundle(in mountPoint: URL) throws -> URL {
        let keys: [URLResourceKey] = [.isApplicationKey, .isPackageKey]
        let enumerator = FileManager.default.enumerator(
            at: mountPoint,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        )

        while let item = enumerator?.nextObject() as? URL {
            if item.pathExtension == "app" {
                return item
            }
        }

        throw UpdateInstallerError.mountedAppNotFound
    }

    private static func uniqueSiblingURL(for url: URL, suffix: String) -> URL {
        let directory = url.deletingLastPathComponent()
        let baseName = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension

        var attempt = 0
        while true {
            let suffixComponent = attempt == 0 ? suffix : "\(suffix)-\(attempt)"
            let filename = ext.isEmpty ? "\(baseName)\(suffixComponent)" : "\(baseName)\(suffixComponent).\(ext)"
            let candidate = directory.appendingPathComponent(filename)
            if !FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
            attempt += 1
        }
    }

    private static func isPermissionError(_ error: Error) -> Bool {
        let nsError = error as NSError

        if nsError.domain == NSCocoaErrorDomain {
            return nsError.code == NSFileWriteNoPermissionError || nsError.code == NSFileWriteVolumeReadOnlyError
        }

        if nsError.domain == NSPOSIXErrorDomain {
            return nsError.code == EACCES || nsError.code == EPERM || nsError.code == EROFS
        }

        return false
    }

    private static func runCommand(executable: String, arguments: [String]) throws -> String {
        let process = Process()
        let outputPipe = Pipe()
        let errorPipe = Pipe()

        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        try process.run()
        process.waitUntilExit()

        let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
        let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
        let combined = outputData + errorData
        let output = String(data: combined, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        guard process.terminationStatus == 0 else {
            throw UpdateInstallerError.commandFailed(output)
        }

        return output
    }
}

private extension Data {
    static func + (lhs: Data, rhs: Data) -> Data {
        var data = lhs
        data.append(rhs)
        return data
    }
}
