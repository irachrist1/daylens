import Foundation
import CryptoKit
import Observation

/// Manages workspace_preferences (hidden apps, hidden domains, privacy PIN) via
/// the Convex HTTP API. Only active when a workspace is linked.
///
/// Follows the same @Observable + Task { @MainActor in } pattern as TodayViewModel.
@Observable
final class PreferencesService {

    private(set) var hiddenApps: Set<String> = []
    private(set) var hiddenDomains: Set<String> = []
    private(set) var privacyPinHash: String? = nil

    // MARK: - Load

    func load() {
        Task { @MainActor in
            await fetchFromServer()
        }
    }

    @MainActor
    private func fetchFromServer() async {
        guard let (cloudUrl, token) = credentials() else { return }
        do {
            let result = try await callConvex(
                cloudUrl: cloudUrl, token: token,
                type: "query", path: "preferences:get", args: [:]
            )
            if let apps = result["hiddenApps"] as? [String] {
                hiddenApps = Set(apps)
            }
            if let domains = result["hiddenDomains"] as? [String] {
                hiddenDomains = Set(domains)
            }
            privacyPinHash = result["privacyPinHash"] as? String
        } catch {
            // Best-effort — stale local state is fine
        }
    }

    // MARK: - Hide / Show Apps

    func hideApp(bundleID: String) {
        let appKey = normalizeAppKey(bundleID)
        hiddenApps.insert(appKey)
        fire(mutation: "preferences:hideApp", args: ["appKey": appKey])
    }

    func showApp(bundleID: String) {
        let appKey = normalizeAppKey(bundleID)
        hiddenApps.remove(appKey)
        fire(mutation: "preferences:showApp", args: ["appKey": appKey])
    }

    /// Remove a hidden app by its stored appKey (e.g. "safari"). Used by PrivacySection.
    func showAppKey(_ appKey: String) {
        hiddenApps.remove(appKey)
        fire(mutation: "preferences:showApp", args: ["appKey": appKey])
    }

    // MARK: - Hide / Show Domains

    func hideDomain(_ domain: String) {
        let normalized = normalizeDomain(domain)
        hiddenDomains.insert(normalized)
        fire(mutation: "preferences:hideDomain", args: ["domain": normalized])
    }

    func showDomain(_ domain: String) {
        let normalized = normalizeDomain(domain)
        hiddenDomains.remove(normalized)
        fire(mutation: "preferences:showDomain", args: ["domain": normalized])
    }

    // MARK: - Privacy PIN

    func setPrivacyPin(_ pin: String) {
        let hash = sha256Hex(pin)
        privacyPinHash = hash
        fire(mutation: "preferences:setPrivacyPin", args: ["pinHash": hash])
    }

    func clearPrivacyPin() {
        privacyPinHash = nil
        fire(mutation: "preferences:clearPrivacyPin", args: [:])
    }

    func verifyPin(_ pin: String) -> Bool {
        guard let stored = privacyPinHash else { return true }
        return sha256Hex(pin) == stored
    }

    // MARK: - Filtering Helpers

    func isAppHidden(_ bundleID: String) -> Bool {
        hiddenApps.contains(normalizeAppKey(bundleID))
    }

    /// Subdomain-aware: hiding "youtube.com" also hides "music.youtube.com".
    func isDomainHidden(_ domain: String) -> Bool {
        let normalized = normalizeDomain(domain)
        for hidden in hiddenDomains {
            if normalized == hidden || normalized.hasSuffix("." + hidden) {
                return true
            }
        }
        return false
    }

    // MARK: - Private helpers

    /// Mirrors SnapshotExporter.normalize() fallback: strips ".app"/".exe", takes last bundleID component.
    /// "com.apple.Safari" → "safari", "com.microsoft.VSCode" → "vscode"
    private func normalizeAppKey(_ bundleID: String) -> String {
        let lowered = bundleID.lowercased()
            .replacingOccurrences(of: ".app", with: "")
            .replacingOccurrences(of: ".exe", with: "")
        return lowered.split(separator: ".").last.map(String.init) ?? lowered
    }

    private func normalizeDomain(_ domain: String) -> String {
        var d = domain.lowercased()
        if d.hasPrefix("www.") { d = String(d.dropFirst(4)) }
        return d
    }

    private func sha256Hex(_ input: String) -> String {
        let hash = SHA256.hash(data: Data(input.utf8))
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    private func fire(mutation: String, args: [String: Any]) {
        Task {
            guard let (cloudUrl, token) = credentials() else { return }
            try? await callConvex(
                cloudUrl: cloudUrl, token: token,
                type: "mutation", path: mutation, args: args
            )
        }
    }

    private func credentials() -> (cloudUrl: String, token: String)? {
        let uploader = SyncUploader.shared
        guard let siteUrl = uploader.convexUrl, let token = uploader.sessionToken else {
            return nil
        }
        // HTTP actions live at .convex.site; queries/mutations at .convex.cloud
        let cloudUrl = siteUrl.replacingOccurrences(of: ".convex.site", with: ".convex.cloud")
        return (cloudUrl, token)
    }

    // MARK: - Convex HTTP API

    @discardableResult
    private func callConvex(
        cloudUrl: String, token: String,
        type: String, path: String, args: [String: Any]
    ) async throws -> [String: Any] {
        let base = cloudUrl.hasSuffix("/") ? cloudUrl : cloudUrl + "/"
        guard let url = URL(string: base + "api/\(type)") else {
            throw PreferencesServiceError.invalidURL
        }

        let body: [String: Any] = ["path": path, "args": args, "format": "json"]
        let bodyData = try JSONSerialization.data(withJSONObject: body)

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = bodyData

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw PreferencesServiceError.serverError
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let status = json["status"] as? String, status == "success",
              let value = json["value"] as? [String: Any] else {
            return [:]
        }
        return value
    }
}

enum PreferencesServiceError: Error {
    case invalidURL
    case serverError
}
