import Foundation

/// Manages periodic sync uploads to the Convex backend.
///
/// Responsibilities:
/// - Device ID management (UUID stored in Keychain)
/// - Workspace token management (stored in Keychain after device link)
/// - Upload scheduler: 5-minute timer + focus-session hooks + app quit
/// - Dirty-day tracking: marks dates that need re-upload
/// - HTTP POST to Convex uploadSnapshot action
final class SyncUploader {

    static let shared = SyncUploader()

    // MARK: - Keychain keys

    private let keychain = KeychainService(service: "com.daylens.sync")
    private static let deviceIdKey = "sync-device-id"
    private static let workspaceTokenKey = "sync-workspace-token"
    private static let workspaceIdKey = "sync-workspace-id"
    private static let convexUrlKey = "sync-convex-url"

    // MARK: - State

    private var timer: Timer?
    private var dirtyDates: Set<String> = []
    private let exporter = SnapshotExporter()
    private let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// Whether a workspace is linked and sync is active.
    var isLinked: Bool { workspaceToken != nil && workspaceId != nil }

    /// Timestamp of last successful sync.
    private(set) var lastSyncAt: Date? {
        get { UserDefaults.standard.object(forKey: "sync.lastSyncAt") as? Date }
        set { UserDefaults.standard.set(newValue, forKey: "sync.lastSyncAt") }
    }

    // MARK: - Device ID

    var deviceId: String {
        if let existing = keychain.string(for: Self.deviceIdKey) {
            return existing
        }
        let newId = UUID().uuidString.lowercased()
        try? keychain.setString(newId, for: Self.deviceIdKey)
        return newId
    }

    // MARK: - Workspace credentials

    var workspaceToken: String? {
        keychain.string(for: Self.workspaceTokenKey)
    }

    var workspaceId: String? {
        keychain.string(for: Self.workspaceIdKey)
    }

    var convexUrl: String? {
        keychain.string(for: Self.convexUrlKey)
    }

    func storeWorkspaceCredentials(token: String, workspaceId: String, convexUrl: String) throws {
        try keychain.setString(token, for: Self.workspaceTokenKey)
        try keychain.setString(workspaceId, for: Self.workspaceIdKey)
        try keychain.setString(convexUrl, for: Self.convexUrlKey)
    }

    func clearWorkspaceCredentials() throws {
        try keychain.removeString(for: Self.workspaceTokenKey)
        try keychain.removeString(for: Self.workspaceIdKey)
        try keychain.removeString(for: Self.convexUrlKey)
        stopSync()
    }

    // MARK: - Dirty-day tracking

    func markDirty(date: Date) {
        dirtyDates.insert(dateFormatter.string(from: date))
    }

    func markTodayDirty() {
        markDirty(date: Date())
    }

    // MARK: - Sync lifecycle

    func startSync() {
        guard isLinked else { return }
        markTodayDirty()
        scheduleTimer()
    }

    func stopSync() {
        timer?.invalidate()
        timer = nil
    }

    /// Called on focus-session start/stop to trigger immediate sync.
    func syncNow() {
        markTodayDirty()
        uploadDirtyDays()
    }

    /// Called on app quit — synchronous-ish best-effort upload.
    func syncOnQuit() {
        markTodayDirty()
        uploadDirtyDays()
    }

    /// Called at local midnight to finalize the previous day.
    func finalizePreviousDay() {
        if let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date()) {
            markDirty(date: yesterday)
        }
        markTodayDirty()
        uploadDirtyDays()
    }

    // MARK: - Timer

    private func scheduleTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.markTodayDirty()
            self?.uploadDirtyDays()
        }
    }

    // MARK: - Upload

    private func uploadDirtyDays() {
        guard isLinked else { return }
        let datesToUpload = dirtyDates
        guard !datesToUpload.isEmpty else { return }

        Task.detached(priority: .utility) { [weak self] in
            guard let self else { return }
            for dateString in datesToUpload {
                guard let date = self.dateFormatter.date(from: dateString) else { continue }
                do {
                    let jsonData = try self.exporter.exportSnapshot(for: date, deviceId: self.deviceId)
                    try await self.postSnapshot(jsonData: jsonData, localDate: dateString)
                    await MainActor.run {
                        self.dirtyDates.remove(dateString)
                    }
                } catch {
                    // Leave in dirtyDates for retry on next tick
                    print("[Sync] Upload failed for \(dateString): \(error.localizedDescription)")
                }
            }
            await MainActor.run {
                self.lastSyncAt = Date()
            }
        }
    }

    private func postSnapshot(jsonData: Data, localDate: String) async throws {
        guard let baseUrl = convexUrl,
              let workspaceId = workspaceId,
              let token = workspaceToken else {
            throw SyncError.notLinked
        }

        // Post to Convex HTTP action endpoint
        let endpoint = baseUrl.hasSuffix("/") ? baseUrl + "uploadSnapshot" : baseUrl + "/uploadSnapshot"
        guard let url = URL(string: endpoint) else {
            throw SyncError.invalidURL
        }

        // Parse the snapshot JSON into the request body
        guard let snapshot = try? JSONSerialization.jsonObject(with: jsonData) else {
            throw SyncError.invalidPayload
        }

        let body: [String: Any] = [
            "workspaceId": workspaceId,
            "deviceId": deviceId,
            "localDate": localDate,
            "snapshot": snapshot,
            "token": token
        ]

        let bodyData = try JSONSerialization.data(withJSONObject: body)

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = bodyData

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw SyncError.uploadFailed(statusCode: statusCode)
        }
    }
}

// MARK: - Errors

enum SyncError: LocalizedError {
    case notLinked
    case invalidURL
    case invalidPayload
    case uploadFailed(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .notLinked: return "No workspace linked."
        case .invalidURL: return "Invalid Convex URL."
        case .invalidPayload: return "Failed to serialize snapshot."
        case .uploadFailed(let code): return "Upload failed (HTTP \(code))."
        }
    }
}
