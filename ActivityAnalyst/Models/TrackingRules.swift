import Foundation

/// Centralized configuration for all tracking rules and thresholds.
/// These values are the recommended v1 defaults per the PRD.
struct TrackingRules: Sendable {
    /// Minimum duration (seconds) for an app to be considered "used"
    static let minimumAppUseDuration: TimeInterval = 5.0

    /// Minimum duration (seconds) for a website visit to be considered meaningful
    static let minimumWebVisitDuration: TimeInterval = 5.0

    /// Minimum duration (seconds) for a session to appear in top-level dashboard summaries
    static let minimumSessionDuration: TimeInterval = 5.0

    /// Maximum gap (seconds) between same-app events before they're considered separate sessions.
    /// Merges across interruptions shorter than this if the same app/site is resumed.
    static let sessionMergeWindow: TimeInterval = 8.0

    /// Grace period (seconds) before idle detection stops counting active work
    static let idleGracePeriod: TimeInterval = 120.0

    /// Debounce window (seconds) for coalescing rapid app switches
    static let switchDebounceWindow: TimeInterval = 2.0

    /// Maximum events to buffer in memory before flushing to database
    static let eventBufferSize: Int = 50

    /// Flush interval (seconds) for writing buffered events to storage
    static let eventFlushInterval: TimeInterval = 2.0

    /// Default data retention period in days
    static let defaultRetentionDays: Int = 90

    /// Number of top items to show in dashboard rankings
    static let dashboardTopN: Int = 10

    /// Minimum cumulative micro-visit duration (seconds) for a domain to appear in rollups
    static let microVisitRollupThreshold: TimeInterval = 60.0

    /// WebSocket port for browser extension communication
    static let extensionBridgePort: UInt16 = 19847

    /// Threshold for focus score calculation: session must be this long to count as "focused"
    static let focusSessionMinimum: TimeInterval = 300.0 // 5 minutes

    /// Rapid switch threshold: switches faster than this contribute to fragmentation score
    static let rapidSwitchThreshold: TimeInterval = 15.0
}

/// User-configurable overrides for tracking rules.
/// Stored in UserDefaults, applied on top of default rules.
struct TrackingPreferences: Codable, Sendable {
    var minimumAppUseDuration: TimeInterval?
    var minimumWebVisitDuration: TimeInterval?
    var sessionMergeWindow: TimeInterval?
    var idleGracePeriod: TimeInterval?
    var retentionDays: Int?
    var trackPrivateBrowsing: PrivateBrowsingMode
    var pauseTracking: Bool

    init(
        minimumAppUseDuration: TimeInterval? = nil,
        minimumWebVisitDuration: TimeInterval? = nil,
        sessionMergeWindow: TimeInterval? = nil,
        idleGracePeriod: TimeInterval? = nil,
        retentionDays: Int? = nil,
        trackPrivateBrowsing: PrivateBrowsingMode = .coarseBrowserOnly,
        pauseTracking: Bool = false
    ) {
        self.minimumAppUseDuration = minimumAppUseDuration
        self.minimumWebVisitDuration = minimumWebVisitDuration
        self.sessionMergeWindow = sessionMergeWindow
        self.idleGracePeriod = idleGracePeriod
        self.retentionDays = retentionDays
        self.trackPrivateBrowsing = trackPrivateBrowsing
        self.pauseTracking = pauseTracking
    }

    var effectiveMinAppUse: TimeInterval {
        minimumAppUseDuration ?? TrackingRules.minimumAppUseDuration
    }

    var effectiveMinWebVisit: TimeInterval {
        minimumWebVisitDuration ?? TrackingRules.minimumWebVisitDuration
    }

    var effectiveMergeWindow: TimeInterval {
        sessionMergeWindow ?? TrackingRules.sessionMergeWindow
    }

    var effectiveIdleGrace: TimeInterval {
        idleGracePeriod ?? TrackingRules.idleGracePeriod
    }

    var effectiveRetentionDays: Int {
        retentionDays ?? TrackingRules.defaultRetentionDays
    }
}

enum PrivateBrowsingMode: String, Codable, CaseIterable, Sendable {
    case trackNothing
    case coarseBrowserOnly
    case trackEverything

    var displayName: String {
        switch self {
        case .trackNothing: return "Don't track anything"
        case .coarseBrowserOnly: return "Track browser time only (no page details)"
        case .trackEverything: return "Track everything (not recommended)"
        }
    }
}
