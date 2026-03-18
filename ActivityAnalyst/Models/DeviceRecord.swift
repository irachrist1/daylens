import Foundation
#if canImport(GRDB)
import GRDB
#endif

/// Represents the device this app is running on.
/// Stored locally for future multi-device support and data provenance.
struct DeviceRecord: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var userId: UUID
    var name: String
    var model: String
    var osVersion: String
    var appVersion: String
    var firstSeen: Date
    var lastSeen: Date

    init(
        id: UUID = UUID(),
        userId: UUID,
        name: String = "",
        model: String = "",
        osVersion: String = "",
        appVersion: String = "1.0.0",
        firstSeen: Date = Date(),
        lastSeen: Date = Date()
    ) {
        self.id = id
        self.userId = userId
        self.name = name
        self.model = model
        self.osVersion = osVersion
        self.appVersion = appVersion
        self.firstSeen = firstSeen
        self.lastSeen = lastSeen
    }

    #if canImport(AppKit)
    /// Creates a DeviceRecord populated from the current system.
    static func current(userId: UUID) -> DeviceRecord {
        let processInfo = ProcessInfo.processInfo
        let hostName = processInfo.hostName

        return DeviceRecord(
            userId: userId,
            name: hostName,
            model: hardwareModel(),
            osVersion: processInfo.operatingSystemVersionString,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
        )
    }

    private static func hardwareModel() -> String {
        var size = 0
        sysctlbyname("hw.model", nil, &size, nil, 0)
        var model = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.model", &model, &size, nil, 0)
        return String(cString: model)
    }
    #endif
}

#if canImport(GRDB)
extension DeviceRecord: FetchableRecord, PersistableRecord {
    static let databaseTableName = "devices"

    enum Columns: String, ColumnExpression {
        case id, userId, name, model, osVersion, appVersion, firstSeen, lastSeen
    }
}
#endif
