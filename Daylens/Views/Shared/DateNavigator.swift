import SwiftUI

/// Date navigation controls: previous day, today pill, next day.
struct DateNavigator: View {
    @Environment(AppState.self) private var appState

    private var dateLabel: String {
        if appState.isToday {
            return "Today"
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d"
        return formatter.string(from: appState.selectedDate)
    }

    var body: some View {
        HStack(spacing: DS.space4) {
            Button(action: appState.goToPreviousDay) {
                Image(systemName: "chevron.left")
                    .font(.body.weight(.medium))
            }
            .buttonStyle(.borderless)
            .help("Previous day")

            Button(action: appState.goToToday) {
                Text(dateLabel)
                    .font(.body.weight(.medium))
                    .padding(.horizontal, DS.space12)
                    .padding(.vertical, DS.space4)
                    .background {
                        if appState.isToday {
                            Capsule()
                                .fill(Color.accentColor.opacity(0.1))
                        } else {
                            Capsule()
                                .fill(.ultraThinMaterial)
                                .shadow(color: .black.opacity(0.04), radius: 0.5, y: 0.5)
                        }
                    }
                    .animation(.easeInOut(duration: 0.2), value: appState.isToday)
            }
            .buttonStyle(.plain)
            .help("Go to today")

            Button(action: appState.goToNextDay) {
                Image(systemName: "chevron.right")
                    .font(.body.weight(.medium))
            }
            .buttonStyle(.borderless)
            .disabled(appState.isToday)
            .help("Next day")
        }
    }
}
