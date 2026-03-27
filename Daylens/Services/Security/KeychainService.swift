import Foundation
import Security

enum KeychainError: LocalizedError {
    case unexpectedStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .unexpectedStatus(let status):
            if let message = SecCopyErrorMessageString(status, nil) as String? {
                return message
            }
            return "Keychain error (\(status))"
        }
    }
}

struct KeychainService {
    let service: String

    private static let testStoreLock = NSLock()
    private static var testStore: [String: String] = [:]

    func string(for account: String) -> String? {
        if Self.isRunningTests {
            return Self.withTestStoreLock {
                Self.testStore[testKey(for: account)]
            }
        }

        var query = baseQuery(for: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }

        return value
    }

    func setString(_ value: String, for account: String) throws {
        if Self.isRunningTests {
            Self.withTestStoreLock {
                Self.testStore[testKey(for: account)] = value
            }
            return
        }

        let data = Data(value.utf8)
        let query = baseQuery(for: account)
        let update: [String: Any] = [
            kSecValueData as String: data
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            var insert = query
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(insert as CFDictionary, nil)
            if addStatus == errSecSuccess { return }
            // Concurrent insert won the race — retry update
            if addStatus == errSecDuplicateItem {
                let retryStatus = SecItemUpdate(query as CFDictionary, update as CFDictionary)
                guard retryStatus == errSecSuccess else {
                    throw KeychainError.unexpectedStatus(retryStatus)
                }
                return
            }
            throw KeychainError.unexpectedStatus(addStatus)
        default:
            throw KeychainError.unexpectedStatus(updateStatus)
        }
    }

    func removeString(for account: String) throws {
        if Self.isRunningTests {
            _ = Self.withTestStoreLock {
                Self.testStore.removeValue(forKey: testKey(for: account))
            }
            return
        }

        let status = SecItemDelete(baseQuery(for: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }

    private func baseQuery(for account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private func testKey(for account: String) -> String {
        "\(service)::\(account)"
    }

    private static var isRunningTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            || ProcessInfo.processInfo.environment["SWIFT_TESTING_ENABLED"] != nil
            || NSClassFromString("XCTestCase") != nil
    }

    private static func withTestStoreLock<T>(_ body: () -> T) -> T {
        testStoreLock.lock()
        defer { testStoreLock.unlock() }
        return body()
    }
}
