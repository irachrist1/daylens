import SwiftUI

struct TimelineView: View {
    @Environment(\.appEnvironment) private var env
    @State private var sessions: [AppSession] = []
    @State private var isLoading = true

    private var dateKey: String { env.selectedDateKey }

    var body: some View {
        ScrollView {
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, minHeight: 200)
            } else if sessions.isEmpty {
                emptyState
            } else {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(sessions) { session in
                        TimelineSegmentView(session: session) {
                            env.inspectorItem = .session(session)
                        }
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .navigationTitle("Timeline — \(dateKey)")
        .task(id: dateKey) { await loadData() }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.system(size: 36))
                .foregroundColor(.secondary)
            Text("No sessions recorded")
                .font(DLTypography.headingSmall)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }

    @MainActor
    private func loadData() async {
        isLoading = true
        sessions = (try? env.aggregator.timelineSegments(for: dateKey)) ?? []
        isLoading = false
    }
}

struct TimelineSegmentView: View {
    let session: AppSession
    var onTap: (() -> Void)?

    private var category: AppCategory {
        AppCategory.classify(bundleId: session.appBundleId, appName: session.appName)
    }

    private var startTimeLabel: String {
        let fmt = DateFormatter()
        fmt.dateFormat = "h:mm a"
        return fmt.string(from: session.startDate)
    }

    var body: some View {
        Button(action: { onTap?() }) {
            HStack(spacing: 12) {
                // Time stamp
                Text(startTimeLabel)
                    .font(DLTypography.captionMono)
                    .foregroundColor(.secondary)
                    .frame(width: 56, alignment: .trailing)

                // Color bar
                RoundedRectangle(cornerRadius: 2)
                    .fill(DLColors.colorForCategory(category))
                    .frame(width: 4)
                    .frame(minHeight: 32)

                // App info
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.appName)
                        .font(DLTypography.bodyMedium)
                        .lineLimit(1)
                    Text(session.activeDuration.durationString)
                        .font(DLTypography.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                // Category badge
                Text(category.rawValue)
                    .font(DLTypography.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(DLColors.colorForCategory(category).opacity(0.15),
                                in: Capsule())
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(Color.clear)
        Divider().padding(.leading, 84)
    }
}
