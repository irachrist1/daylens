import Foundation

/// A user-planned work slot for a future hour, stored in UserDefaults (not the database).
struct FocusSlot: Codable, Identifiable {
    var id: UUID
    var slotStart: Date
    var durationMinutes: Int
    var intent: String
}
