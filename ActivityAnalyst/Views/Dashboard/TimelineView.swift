import SwiftUI

/// Stacked daily timeline showing sessions across hours of the day.
struct TimelineView: View {
    @StateObject private var viewModel = TimelineViewModel()
    let date: Date

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing16) {
                header

                if viewModel.timelineSessions.isEmpty {
                    EmptyStateView(
                        icon: "calendar.day.timeline.leading",
                        title: "No Timeline Data",
                        message: "Sessions will appear here as your day progresses."
                    )
                } else {
                    timelineContent
                }
            }
            .padding(Theme.spacing24)
        }
        .task {
            viewModel.setSelectedDay(date)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Theme.spacing4) {
            Text("Timeline")
                .font(Theme.Typography.title)
                .foregroundStyle(Theme.Colors.primaryText)

            Text(DateFormatters.relativeDay(date))
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.secondaryText)
        }
    }

    private var timelineContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(viewModel.sessionsByHour, id: \.hour) { hourGroup in
                TimelineHourRow(
                    hour: hourGroup.hour,
                    sessions: hourGroup.sessions,
                    selectedSession: $viewModel.selectedSession
                )
            }
        }
    }
}

struct TimelineHourRow: View {
    let hour: Int
    let sessions: [Session]
    @Binding var selectedSession: Session?

    private var hourLabel: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h a"
        let components = DateComponents(hour: hour)
        let date = Calendar.current.date(from: components) ?? Date()
        return formatter.string(from: date)
    }

    var body: some View {
        HStack(alignment: .top, spacing: Theme.spacing12) {
            Text(hourLabel)
                .font(Theme.Typography.monoSmall)
                .foregroundStyle(Theme.Colors.tertiaryText)
                .frame(width: 50, alignment: .trailing)

            VStack(alignment: .leading, spacing: Theme.spacing4) {
                if sessions.isEmpty {
                    Rectangle()
                        .fill(Theme.Colors.separator.opacity(0.2))
                        .frame(height: 1)
                        .padding(.vertical, Theme.spacing8)
                } else {
                    ForEach(sessions) { session in
                        TimelineSessionBlock(
                            session: session,
                            isSelected: selectedSession?.id == session.id
                        )
                        .onTapGesture {
                            selectedSession = session
                        }
                    }
                }
            }
        }
        .padding(.vertical, Theme.spacing4)
    }
}

struct TimelineSessionBlock: View {
    let session: Session
    let isSelected: Bool

    var body: some View {
        HStack(spacing: Theme.spacing8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Theme.Colors.category(session.category))
                .frame(width: 3)

            VStack(alignment: .leading, spacing: Theme.spacing2) {
                Text("Session")
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)

                Text(DurationFormatter.format(session.duration))
                    .font(Theme.Typography.monoSmall)
                    .foregroundStyle(Theme.Colors.secondaryText)
            }

            Spacer()
        }
        .padding(Theme.spacing8)
        .background(
            isSelected
                ? Theme.Colors.accentSubtle
                : Theme.Colors.groupedBackground
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))
    }
}
