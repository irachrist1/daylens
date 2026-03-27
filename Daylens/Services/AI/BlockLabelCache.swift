import Foundation

struct BlockLabelCache {
    // These labels are a best-effort UI cache, so we keep them in UserDefaults
    // instead of adding a migration-backed table. That avoids schema risk for
    // optional metadata, while pruneExpiredLabels() keeps the key space bounded.
    private static let keyPrefix = "daylens.blockLabel."

    private let defaults: UserDefaults
    private let calendar: Calendar
    private let dateFormatter: DateFormatter

    init(defaults: UserDefaults = .standard, calendar: Calendar = .current) {
        self.defaults = defaults
        self.calendar = calendar

        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        self.dateFormatter = formatter
    }

    func saveCachedLabel(_ label: String, for block: WorkContextBlock, date: Date) {
        let normalized = Self.normalize(label)
        guard !normalized.isEmpty else { return }
        defaults.set(normalized, forKey: cacheKey(for: block, date: date))
    }

    func loadCachedLabel(for block: WorkContextBlock, date: Date) -> String? {
        guard let label = defaults.string(forKey: cacheKey(for: block, date: date)) else {
            return nil
        }

        let normalized = Self.normalize(label)
        return normalized.isEmpty ? nil : normalized
    }

    func pruneExpiredLabels(retentionDays: Int = Constants.defaultRetentionDays, referenceDate: Date = Date()) {
        guard let cutoff = calendar.date(byAdding: .day, value: -retentionDays, to: referenceDate) else {
            return
        }

        let cutoffDay = calendar.startOfDay(for: cutoff)
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(Self.keyPrefix) {
            guard let storedDate = storedDate(from: key), storedDate < cutoffDay else {
                continue
            }
            defaults.removeObject(forKey: key)
        }
    }

    private func cacheKey(for block: WorkContextBlock, date: Date) -> String {
        let dayKey = dateFormatter.string(from: date)
        let startStamp = Int(block.startTime.timeIntervalSince1970)
        return "\(Self.keyPrefix)\(dayKey).\(startStamp)"
    }

    private func storedDate(from key: String) -> Date? {
        let suffix = String(key.dropFirst(Self.keyPrefix.count))
        guard let dateKey = suffix.split(separator: ".", maxSplits: 1).first else {
            return nil
        }
        return dateFormatter.date(from: String(dateKey))
    }

    private static func normalize(_ label: String) -> String {
        let trimmed = label
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))

        guard let firstLine = trimmed.split(whereSeparator: \.isNewline).first else {
            return trimmed
        }

        return String(firstLine).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
