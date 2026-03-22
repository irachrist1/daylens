import Foundation
import CryptoKit
import Security

/// Handles workspace creation, BIP39 mnemonic recovery, and device linking via QR/short code.
final class WorkspaceLinker {

    // MARK: - Workspace creation

    struct WorkspaceResult {
        let workspaceId: String
        let mnemonic: String
        let linkCode: String
        let linkToken: String
    }

    struct BrowserLinkResult {
        let displayCode: String
        let fullToken: String
    }

    /// Creates a new anonymous workspace on the Convex backend.
    /// Generates a BIP39 mnemonic and derives the workspaceId.
    func createWorkspace(convexSiteUrl: String) async throws -> WorkspaceResult {
        let mnemonic = generateMnemonic()
        let workspaceId = deriveWorkspaceId(from: mnemonic)
        let recoveryKeyHash = sha256Hex(workspaceId)

        // Call Convex createWorkspace mutation
        let body: [String: Any] = [
            "recoveryKeyHash": recoveryKeyHash,
            "deviceId": SyncUploader.shared.deviceId,
            "displayName": desktopDisplayName(),
            "platform": "macos"
        ]
        let result = try await callConvexAction(
            baseUrl: convexSiteUrl,
            path: "createWorkspace",
            body: body
        )

        guard let sessionToken = result["sessionToken"] as? String else {
            throw WorkspaceLinkError.invalidResponse
        }

        try SyncUploader.shared.storeWorkspaceCredentials(
            sessionToken: sessionToken,
            workspaceId: workspaceId,
            convexUrl: convexSiteUrl
        )

        // Store mnemonic in Keychain for recovery display
        let keychain = KeychainService(service: "com.daylens.sync")
        try keychain.setString(mnemonic, for: "recovery-mnemonic")

        let browserLink = try await createBrowserLink(
            convexSiteUrl: convexSiteUrl,
            sessionToken: sessionToken
        )

        return WorkspaceResult(
            workspaceId: workspaceId,
            mnemonic: mnemonic,
            linkCode: browserLink.displayCode,
            linkToken: browserLink.fullToken
        )
    }

    /// Recover a workspace using a mnemonic phrase.
    func recoverWorkspace(mnemonic: String, convexSiteUrl: String) async throws -> String {
        let normalized = normalizeMnemonic(mnemonic)
        let workspaceId = deriveWorkspaceId(from: normalized)
        let recoveryKeyHash = sha256Hex(workspaceId)

        let body: [String: Any] = [
            "recoveryKeyHash": recoveryKeyHash,
            "deviceId": SyncUploader.shared.deviceId,
            "displayName": desktopDisplayName(),
            "platform": "macos"
        ]
        let result = try await callConvexAction(
            baseUrl: convexSiteUrl,
            path: "recoverWorkspace",
            body: body
        )

        guard let sessionToken = result["sessionToken"] as? String else {
            throw WorkspaceLinkError.workspaceNotFound
        }

        try SyncUploader.shared.storeWorkspaceCredentials(
            sessionToken: sessionToken,
            workspaceId: workspaceId,
            convexUrl: convexSiteUrl
        )

        let keychain = KeychainService(service: "com.daylens.sync")
        try keychain.setString(normalized, for: "recovery-mnemonic")

        return workspaceId
    }

    /// Upload Anthropic API key (envelope-encrypted on server).
    func uploadApiKey(apiKey: String, convexSiteUrl: String) async throws {
        guard let sessionToken = SyncUploader.shared.sessionToken else {
            throw WorkspaceLinkError.notLinked
        }

        let body: [String: Any] = [
            "anthropicKey": apiKey
        ]
        _ = try await callConvexAction(
            baseUrl: convexSiteUrl,
            path: "storeApiKey",
            body: body,
            bearerToken: sessionToken
        )
    }

    func createBrowserLink() async throws -> BrowserLinkResult {
        guard let convexSiteUrl = SyncUploader.shared.convexUrl,
              let sessionToken = SyncUploader.shared.sessionToken else {
            throw WorkspaceLinkError.notLinked
        }

        return try await createBrowserLink(
            convexSiteUrl: convexSiteUrl,
            sessionToken: sessionToken
        )
    }

    // MARK: - BIP39 mnemonic generation

    /// Generate a 12-word BIP39 English mnemonic (128 bits entropy).
    private func generateMnemonic() -> String {
        // 128 bits of entropy — must succeed or the mnemonic would be deterministic
        var entropy = [UInt8](repeating: 0, count: 16)
        let status = SecRandomCopyBytes(kSecRandomDefault, entropy.count, &entropy)
        guard status == errSecSuccess else {
            fatalError("SecRandomCopyBytes failed with status \(status) — cannot generate secure mnemonic")
        }

        // SHA256 checksum — first 4 bits
        let hash = SHA256.hash(data: Data(entropy))
        let checksumByte = Array(hash).first ?? 0

        // Combine: 128 bits entropy + 4 bits checksum = 132 bits
        var bits = entropy.flatMap { byte in
            (0..<8).map { i in (byte >> (7 - i)) & 1 }
        }
        bits.append(contentsOf: (0..<4).map { i in (checksumByte >> (7 - i)) & 1 })

        // Split into 12 groups of 11 bits
        let words = (0..<12).map { i -> String in
            let start = i * 11
            var index = 0
            for j in 0..<11 {
                index = (index << 1) | Int(bits[start + j])
            }
            return BIP39Wordlist.english[index]
        }

        return words.joined(separator: " ")
    }

    // MARK: - Workspace ID derivation

    /// workspaceId = "ws_" + base32(sha256("daylens-workspace-v1:" + normalizedMnemonic)).slice(0, 26)
    func deriveWorkspaceId(from mnemonic: String) -> String {
        let normalized = normalizeMnemonic(mnemonic)
        let input = "daylens-workspace-v1:" + normalized
        let hash = SHA256.hash(data: Data(input.utf8))
        let base32 = base32Encode(Data(hash))
        return "ws_" + String(base32.prefix(26)).lowercased()
    }

    private func normalizeMnemonic(_ mnemonic: String) -> String {
        mnemonic.lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: " ")
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    private func createBrowserLink(
        convexSiteUrl: String,
        sessionToken: String
    ) async throws -> BrowserLinkResult {
        let fullToken = generateLinkToken()
        let displayCode = String(fullToken.prefix(8)).uppercased()
        let tokenHash = sha256Hex(fullToken)

        let body: [String: Any] = [
            "tokenHash": tokenHash,
            "displayCode": displayCode
        ]

        _ = try await callConvexAction(
            baseUrl: convexSiteUrl,
            path: "createLinkCode",
            body: body,
            bearerToken: sessionToken
        )

        return BrowserLinkResult(
            displayCode: displayCode,
            fullToken: fullToken
        )
    }

    private func generateLinkToken() -> String {
        var entropy = [UInt8](repeating: 0, count: 16)
        let status = SecRandomCopyBytes(kSecRandomDefault, entropy.count, &entropy)
        guard status == errSecSuccess else {
            fatalError("SecRandomCopyBytes failed with status \(status) — cannot generate secure link token")
        }
        return entropy.map { String(format: "%02x", $0) }.joined()
    }

    private func desktopDisplayName() -> String {
        Host.current().localizedName ?? "This Mac"
    }

    // MARK: - Helpers

    private func sha256Hex(_ input: String) -> String {
        let hash = SHA256.hash(data: Data(input.utf8))
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    private func base32Encode(_ data: Data) -> String {
        let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        let chars = Array(alphabet)
        var result = ""
        var bits = 0
        var buffer = 0

        for byte in data {
            buffer = (buffer << 8) | Int(byte)
            bits += 8
            while bits >= 5 {
                bits -= 5
                let index = (buffer >> bits) & 0x1F
                result.append(chars[index])
            }
        }

        if bits > 0 {
            let index = (buffer << (5 - bits)) & 0x1F
            result.append(chars[index])
        }

        return result
    }

    // MARK: - Network

    @discardableResult
    private func callConvexAction(
        baseUrl: String,
        path: String,
        body: [String: Any],
        bearerToken: String? = nil
    ) async throws -> [String: Any] {
        let endpoint = baseUrl.hasSuffix("/") ? baseUrl + path : baseUrl + "/" + path
        guard let url = URL(string: endpoint) else {
            throw WorkspaceLinkError.invalidURL
        }

        let bodyData = try JSONSerialization.data(withJSONObject: body)

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = bodyData

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw WorkspaceLinkError.serverError(statusCode: statusCode)
        }

        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}

// MARK: - Errors

enum WorkspaceLinkError: LocalizedError {
    case invalidURL
    case invalidResponse
    case workspaceNotFound
    case notLinked
    case serverError(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid server URL."
        case .invalidResponse: return "Unexpected server response."
        case .workspaceNotFound: return "Workspace not found. Check your recovery phrase."
        case .notLinked: return "No workspace linked."
        case .serverError(let code): return "Server error (HTTP \(code))."
        }
    }
}
