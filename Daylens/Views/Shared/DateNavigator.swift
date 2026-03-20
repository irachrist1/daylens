import SwiftUI

/// Date navigation controls: previous day, today pill, next day.
struct DateNavigator: View {
    @Environment(AppState.self) private var appState

    private var dateLabel: String {
        if appState.isToday { return "Today" }
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d"
        return formatter.string(from: appState.selectedDate)
    }

    var body: some View {
        HStack(spacing: DS.space4) {
            Button(action: appState.goToPreviousDay) {
                Image(systemName: "chevron.left")
                    .font(.body.weight(.medium))
                    .foregroundStyle(DS.onSurfaceVariant)
            }
            .buttonStyle(.borderless)
            .help("Previous day")

            Button(action: appState.goToToday) {
                Text(dateLabel)
                    .font(.body.weight(.medium))
                    .foregroundStyle(appState.isToday ? DS.primary : DS.onSurface)
                    .padding(.horizontal, DS.space12)
                    .padding(.vertical, DS.space4)
                    .background(
                        Capsule()
                            .fill(appState.isToday ? DS.primary.opacity(0.12) : DS.surfaceHighest)
                    )
                    .animation(.easeInOut(duration: 0.2), value: appState.isToday)
            }
            .buttonStyle(.plain)
            .help("Go to today")

            Button(action: appState.goToNextDay) {
                Image(systemName: "chevron.right")
                    .font(.body.weight(.medium))
                    .foregroundStyle(DS.onSurfaceVariant)
            }
            .buttonStyle(.borderless)
            .disabled(appState.isToday)
            .help("Next day")
        }
    }
}
