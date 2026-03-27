import Foundation

enum UsageMetricMode: String, CaseIterable, Identifiable, Codable {
    case meaningful
    case appleLike

    var id: String { rawValue }

    var title: String {
        switch self {
        case .meaningful: "Active Use"
        case .appleLike: "All Activity"
        }
    }

    var subtitle: String {
        switch self {
        case .meaningful: "Counts time while you are actively using your Mac"
        case .appleLike: "Counts all foreground app time, including reading and watching"
        }
    }
}

struct DayUsageMetrics {
    let meaningfulTotal: TimeInterval
    let appleLikeTotal: TimeInterval

    func total(for mode: UsageMetricMode) -> TimeInterval {
        switch mode {
        case .meaningful: meaningfulTotal
        case .appleLike: appleLikeTotal
        }
    }
}
