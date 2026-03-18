import Foundation

/// Represents the current state of the tracking system.
enum TrackingState: Equatable {
    case idle
    case tracking
    case paused
    case error(String)

    var isActive: Bool {
        self == .tracking
    }

    var statusLabel: String {
        switch self {
        case .idle: return "Not Started"
        case .tracking: return "Tracking"
        case .paused: return "Paused"
        case .error(let msg): return "Error: \(msg)"
        }
    }
}

/// Info about a currently tracked app.
struct ActiveAppInfo: Equatable {
    let bundleID: String
    let appName: String
    let windowTitle: String?
    let activatedAt: Date

    var elapsed: TimeInterval {
        Date().timeIntervalSince(activatedAt)
    }
}
