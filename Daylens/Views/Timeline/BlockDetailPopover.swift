import SwiftUI

/// Hover-detail popover showing session breakdown for a `WorkContextBlock`.
struct BlockDetailPopover: View {
    let block: WorkContextBlock

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            headerSection

            Divider()
                .overlay(DS.surfaceHighest.opacity(0.6))

            sessionsSection

            if !block.websites.isEmpty && isBrowserHeavy {
                Divider()
                    .overlay(DS.surfaceHighest.opacity(0.6))
                websitesSection
            }

            if block.switchCount > 5 {
                Text("\(block.switchCount) context switches")
                    .font(.system(size: 11))
                    .foregroundStyle(DS.onSurfaceVariant)
            }
        }
        .padding(DS.space12)
        .frame(maxWidth: 280)
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: DS.space4) {
            HStack(alignment: .top, spacing: DS.space6) {
                Text(block.displayLabel)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DS.onSurface)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                CategoryBadge(category: block.dominantCategory)
            }
            Text(formattedDuration(block.duration))
                .font(.system(size: 12).monospacedDigit())
                .foregroundStyle(DS.onSurfaceVariant)
        }
    }

    // MARK: - Sessions

    private var sessionsSection: some View {
        let sorted = block.sessions.sorted { $0.startTime < $1.startTime }
        let visible = Array(sorted.prefix(8))
        let overflow = sorted.count - 8

        return VStack(alignment: .leading, spacing: DS.space6) {
            ForEach(visible) { session in
                sessionRow(session)
            }
            if overflow > 0 {
                Text("and \(overflow) more")
                    .font(.system(size: 11))
                    .foregroundStyle(DS.onSurfaceVariant)
            }
        }
    }

    private func sessionRow(_ session: AppSession) -> some View {
        HStack(spacing: DS.space6) {
            AppIconView(bundleID: session.bundleID, size: 16)
                .frame(width: 16, height: 16)
            Text(session.appName)
                .font(.system(size: 12))
                .foregroundStyle(DS.onSurface)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(sessionTimeRange(session))
                .font(.system(size: 11).monospacedDigit())
                .foregroundStyle(DS.onSurfaceVariant)
        }
    }

    // MARK: - Websites

    private var websitesSection: some View {
        VStack(alignment: .leading, spacing: DS.space4) {
            Text("Top sites:")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DS.onSurfaceVariant)
            ForEach(block.websites.prefix(3)) { site in
                HStack {
                    Text(site.domain)
                        .font(.system(size: 11))
                        .foregroundStyle(DS.onSurface)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(site.formattedDuration)
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(DS.onSurfaceVariant)
                }
            }
        }
    }

    // MARK: - Helpers

    private var isBrowserHeavy: Bool {
        block.sessions.contains { $0.isBrowser }
    }

    private func formattedDuration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        if hours > 0 && minutes > 0 { return "\(hours)h \(minutes)m" }
        if hours > 0 { return "\(hours)h" }
        if minutes > 0 { return "\(minutes)m" }
        return "\(total % 60)s"
    }

    private func sessionTimeRange(_ session: AppSession) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm"
        return "\(formatter.string(from: session.startTime))–\(formatter.string(from: session.endTime))"
    }
}
