import Foundation
#if canImport(AppKit)
import AppKit
#endif

/// Handles data export and deletion operations.
struct DataExporter {
    /// Exports all activity data to a JSON file.
    #if canImport(GRDB)
    static func exportToJSON(store: ActivityStore) async throws -> URL {
        let exportData = try await store.exportAllData()

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        let jsonData = try encoder.encode(exportData)

        let tempDir = FileManager.default.temporaryDirectory
        let filename = "activity-analyst-export-\(DateFormatters.shortDate.string(from: Date())).json"
        let fileURL = tempDir.appendingPathComponent(filename)

        try jsonData.write(to: fileURL)

        return fileURL
    }
    #endif

    /// Presents a save panel for the user to choose export location.
    #if canImport(AppKit)
    static func presentSavePanel(for sourceURL: URL) async -> URL? {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async {
                let panel = NSSavePanel()
                panel.nameFieldStringValue = sourceURL.lastPathComponent
                panel.allowedContentTypes = [.json]
                panel.canCreateDirectories = true

                panel.begin { response in
                    if response == .OK, let url = panel.url {
                        try? FileManager.default.copyItem(at: sourceURL, to: url)
                        continuation.resume(returning: url)
                    } else {
                        continuation.resume(returning: nil)
                    }
                }
            }
        }
    }
    #endif

    /// Deletes all stored data after user confirmation.
    #if canImport(GRDB)
    static func deleteAllData(store: ActivityStore) async throws {
        try await store.deleteAllData()
    }
    #endif
}
