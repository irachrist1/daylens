import Foundation

extension Date {
    /// YYYY-MM-DD string in the current timezone
    var dateKey: String {
        AppSession.makeDateKey(from: timeIntervalSince1970)
    }

    /// "Today", "Yesterday", or "Mon Jan 6"
    var relativeLabel: String {
        let cal = Calendar.current
        if cal.isDateInToday(self) { return "Today" }
        if cal.isDateInYesterday(self) { return "Yesterday" }
        let fmt = DateFormatter()
        fmt.dateFormat = "EEE MMM d"
        return fmt.string(from: self)
    }
}

extension Double {
    /// Formats seconds into "2h 14m", "45m", "12s"
    var durationString: String {
        let total = Int(self)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60

        if hours > 0 && minutes > 0 {
            return "\(hours)h \(minutes)m"
        } else if hours > 0 {
            return "\(hours)h"
        } else if minutes > 0 {
            return "\(minutes)m"
        } else {
            return "\(seconds)s"
        }
    }

    /// Short format: "2h", "45m", "12s"
    var shortDurationString: String {
        let total = Int(self)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60

        if hours > 0 { return "\(hours)h" }
        if minutes > 0 { return "\(minutes)m" }
        return "\(seconds)s"
    }
}
