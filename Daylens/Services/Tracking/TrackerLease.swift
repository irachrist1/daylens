import Foundation
import Darwin

final class TrackerLease {
    struct ConflictDetails {
        let pid: Int32?
        let executablePath: String?

        var message: String {
            var parts: [String] = []
            if let executablePath, !executablePath.isEmpty {
                parts.append(executablePath)
            }
            if let pid {
                parts.append("PID \(pid)")
            }
            if parts.isEmpty {
                return "Another Daylens instance is already tracking this database."
            }
            return "Another Daylens instance is already tracking this database: \(parts.joined(separator: " • "))"
        }
    }

    private struct OwnerMetadata: Codable {
        let pid: Int32
        let executablePath: String
        let startedAt: Date
    }

    private let lockURL: URL
    private let metadataURL: URL
    private var lockFD: Int32 = -1
    private var ownsLease = false

    init(directoryURL: URL) {
        self.lockURL = directoryURL.appendingPathComponent("tracker.lock")
        self.metadataURL = directoryURL.appendingPathComponent("tracker-owner.json")
    }

    deinit {
        release()
    }

    func acquire() -> ConflictDetails? {
        if ownsLease { return nil }

        let fd = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard fd >= 0 else {
            return ConflictDetails(pid: nil, executablePath: nil)
        }

        if flock(fd, LOCK_EX | LOCK_NB) == 0 {
            lockFD = fd
            ownsLease = true
            writeMetadata()
            return nil
        }

        close(fd)
        return readConflictDetails()
    }

    func release() {
        guard ownsLease, lockFD >= 0 else { return }
        flock(lockFD, LOCK_UN)
        close(lockFD)
        lockFD = -1
        ownsLease = false

        let decoder = JSONDecoder()
        if let data = try? Data(contentsOf: metadataURL),
           let metadata = try? decoder.decode(OwnerMetadata.self, from: data),
           metadata.pid == getpid() {
            try? FileManager.default.removeItem(at: metadataURL)
        }
    }

    private func writeMetadata() {
        let executablePath = Bundle.main.executableURL?.path ?? ProcessInfo.processInfo.arguments.first ?? ""
        let metadata = OwnerMetadata(pid: getpid(), executablePath: executablePath, startedAt: Date())
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(metadata) {
            try? data.write(to: metadataURL, options: .atomic)
        }
    }

    private func readConflictDetails() -> ConflictDetails {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let data = try? Data(contentsOf: metadataURL),
              let metadata = try? decoder.decode(OwnerMetadata.self, from: data) else {
            return ConflictDetails(pid: nil, executablePath: nil)
        }
        return ConflictDetails(pid: metadata.pid, executablePath: metadata.executablePath)
    }
}
