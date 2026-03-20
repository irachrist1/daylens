import SwiftUI

/// Top toolbar: date navigation on the left, stop-session button on the right when a focus session is active.
struct HeaderBar: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        HStack {
            DateNavigator()
            Spacer()
            if appState.focusSession.isRunning {
                Button {
                    appState.focusSession.stop()
                } label: {
                    Text("Stop Session")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, DS.space12)
                        .padding(.vertical, DS.space6)
                        .background(DS.error, in: Capsule(style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, DS.space20)
        .padding(.vertical, DS.space12)
        .background(DS.surfaceLow)
    }
}
