import Foundation

/// Formats TimeInterval values into human-readable duration strings.
enum DurationFormatter {
    /// Formats a duration into a compact string like "2h 15m" or "45s"
    static func format(_ interval: TimeInterval) -> String {
        let totalSeconds = Int(interval)

        if totalSeconds < 60 {
            return "\(totalSeconds)s"
        }

        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60

        if hours > 0 {
            if minutes > 0 {
                return "\(hours)h \(minutes)m"
            }
            return "\(hours)h"
        }

        return "\(minutes)m"
    }

    /// Formats a duration with full words: "2 hours, 15 minutes"
    static func formatLong(_ interval: TimeInterval) -> String {
        let totalSeconds = Int(interval)

        if totalSeconds < 60 {
            return "\(totalSeconds) second\(totalSeconds == 1 ? "" : "s")"
        }

        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60

        var parts: [String] = []
        if hours > 0 {
            parts.append("\(hours) hour\(hours == 1 ? "" : "s")")
        }
        if minutes > 0 {
            parts.append("\(minutes) minute\(minutes == 1 ? "" : "s")")
        }

        return parts.joined(separator: ", ")
    }

    /// Formats a duration as a decimal: "2.25h" or "45m"
    static func formatDecimal(_ interval: TimeInterval) -> String {
        let hours = interval / 3600.0

        if hours >= 1.0 {
            return String(format: "%.1fh", hours)
        }

        let minutes = interval / 60.0
        return String(format: "%.0fm", minutes)
    }

    /// Formats a percentage: "45%"
    static func formatPercentage(_ value: Double) -> String {
        "\(Int(value * 100))%"
    }
}
