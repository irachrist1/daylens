import Foundation

// MARK: - Event Types

enum EventType: String, Codable, CaseIterable, Sendable {
    case appActivated
    case appDeactivated
    case appLaunched
    case appTerminated
    case tabChanged
    case urlChanged
    case idleStart
    case idleEnd
    case sessionStart
    case sessionEnd
}

// MARK: - Capture Source

enum CaptureSource: String, Codable, CaseIterable, Sendable {
    case native
    case `extension`
    case heuristic
    case manual

    var displayName: String {
        switch self {
        case .native: return "System"
        case .extension: return "Extension"
        case .heuristic: return "Inferred"
        case .manual: return "Manual"
        }
    }

    var confidenceWeight: Double {
        switch self {
        case .native: return 0.9
        case .extension: return 1.0
        case .heuristic: return 0.6
        case .manual: return 1.0
        }
    }
}

// MARK: - Activity Category

enum ActivityCategory: String, Codable, CaseIterable, Sendable {
    case productivity
    case communication
    case entertainment
    case social
    case reference
    case development
    case design
    case writing
    case finance
    case shopping
    case news
    case health
    case education
    case utilities
    case uncategorized

    var displayName: String {
        rawValue.capitalized
    }

    var sfSymbol: String {
        switch self {
        case .productivity: return "briefcase.fill"
        case .communication: return "bubble.left.and.bubble.right.fill"
        case .entertainment: return "play.circle.fill"
        case .social: return "person.2.fill"
        case .reference: return "book.fill"
        case .development: return "chevron.left.forwardslash.chevron.right"
        case .design: return "paintbrush.fill"
        case .writing: return "doc.text.fill"
        case .finance: return "dollarsign.circle.fill"
        case .shopping: return "cart.fill"
        case .news: return "newspaper.fill"
        case .health: return "heart.fill"
        case .education: return "graduationcap.fill"
        case .utilities: return "wrench.and.screwdriver.fill"
        case .uncategorized: return "questionmark.circle"
        }
    }

    var isFocusCategory: Bool {
        switch self {
        case .productivity, .development, .design, .writing, .education, .reference:
            return true
        default:
            return false
        }
    }
}

// MARK: - Insight Type

enum InsightType: String, Codable, CaseIterable, Sendable {
    case pattern
    case anomaly
    case recommendation
    case trend
    case comparison

    var sfSymbol: String {
        switch self {
        case .pattern: return "arrow.triangle.2.circlepath"
        case .anomaly: return "exclamationmark.triangle"
        case .recommendation: return "lightbulb.fill"
        case .trend: return "chart.line.uptrend.xyaxis"
        case .comparison: return "arrow.left.arrow.right"
        }
    }
}

// MARK: - Message Role

enum MessageRole: String, Codable, Sendable {
    case user
    case assistant
}

// MARK: - AI Model

enum AIModel: String, Codable, CaseIterable, Sendable {
    case sonnet = "claude-sonnet-4-20250514"
    case opus = "claude-opus-4-20250514"
    case haiku = "claude-haiku-4-20250414"

    var displayName: String {
        switch self {
        case .sonnet: return "Claude Sonnet 4.6"
        case .opus: return "Claude Opus 4.6"
        case .haiku: return "Claude Haiku 4.5"
        }
    }
}

// MARK: - Tracking State

enum TrackingState: String, Codable, Sendable {
    case active
    case paused
    case idle
    case disabled
}

// MARK: - Permission Status

enum PermissionStatus: String, Codable, Sendable {
    case notDetermined
    case granted
    case denied
    case restricted

    var isUsable: Bool {
        self == .granted
    }
}

// MARK: - Sidebar Navigation

enum SidebarDestination: String, CaseIterable, Identifiable, Sendable {
    case today
    case apps
    case browsers
    case websites
    case insights
    case history
    case settings

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .today: return "Today"
        case .apps: return "Apps"
        case .browsers: return "Browsers"
        case .websites: return "Websites"
        case .insights: return "Insights"
        case .history: return "History"
        case .settings: return "Settings"
        }
    }

    var sfSymbol: String {
        switch self {
        case .today: return "sun.max.fill"
        case .apps: return "square.grid.2x2.fill"
        case .browsers: return "globe"
        case .websites: return "link"
        case .insights: return "brain.head.profile"
        case .history: return "clock.arrow.circlepath"
        case .settings: return "gearshape.fill"
        }
    }
}
