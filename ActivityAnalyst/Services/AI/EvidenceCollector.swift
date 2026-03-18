import Foundation

/// Collects and formats evidence from stored activity data
/// to support AI responses with grounded citations.
struct EvidenceCollector {

    /// Collects evidence relevant to a user's question.
    #if canImport(GRDB)
    static func collectEvidence(
        for question: String,
        store: ActivityStore,
        from: Date,
        to: Date
    ) async throws -> [EvidenceReference] {
        var evidence: [EvidenceReference] = []
        let lowered = question.lowercased()

        let appDurations = try await store.appDurations(from: from, to: to)
        for item in appDurations {
            if lowered.contains(item.name.lowercased()) {
                evidence.append(EvidenceReference(
                    appName: item.name,
                    duration: item.duration,
                    description: "\(item.name): \(DurationFormatter.format(item.duration))"
                ))
            }
        }

        let websiteDurations = try await store.websiteDurations(from: from, to: to)
        for item in websiteDurations {
            if lowered.contains(item.domain.lowercased()) {
                evidence.append(EvidenceReference(
                    domain: item.domain,
                    duration: item.duration,
                    description: "\(item.domain): \(DurationFormatter.format(item.duration))"
                ))
            }
        }

        let browserDurations = try await store.browserDurations(from: from, to: to)
        for item in browserDurations {
            if lowered.contains(item.name.lowercased()) {
                evidence.append(EvidenceReference(
                    appName: item.name,
                    duration: item.duration,
                    description: "\(item.name) browser: \(DurationFormatter.format(item.duration))"
                ))
            }
        }

        if evidence.isEmpty {
            let totalActive = appDurations.reduce(0.0) { $0 + $1.duration }
            evidence.append(EvidenceReference(
                description: "Total tracked: \(DurationFormatter.format(totalActive)) across \(appDurations.count) apps"
            ))
        }

        return evidence
    }
    #endif

    /// Formats evidence references into a human-readable citation block.
    static func formatCitations(_ evidence: [EvidenceReference]) -> String {
        guard !evidence.isEmpty else { return "" }

        var lines = ["Sources:"]
        for (index, ref) in evidence.enumerated() {
            lines.append("[\(index + 1)] \(ref.description)")
        }
        return lines.joined(separator: "\n")
    }
}
