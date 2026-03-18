import Foundation

/// Represents activity intensity for a single hour (0–23).
/// Used by the density strip and dashboard ViewModels.
struct HourlyActivityBucket: Identifiable, Sendable {
    let id: Int // hour 0–23
    let activeMinutes: Double
    let dominantCategory: ActivityCategory
}
