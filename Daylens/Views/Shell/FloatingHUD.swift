import SwiftUI

/// Floating focus-session HUD anchored to the bottom of the window.
/// Appears only while a session is running.
struct FloatingHUD: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        if appState.focusSession.isRunning {
            HStack(spacing: DS.space16) {
                // Animated ring
                ZStack {
                    Circle()
                        .stroke(DS.surfaceHighest, lineWidth: 3)
                        .frame(width: 36, height: 36)
                    Circle()
                        .trim(from: 0, to: appState.focusSession.progress)
                        .stroke(DS.primary, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .frame(width: 36, height: 36)
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 1), value: appState.focusSession.progress)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("Focus Session")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(DS.onSurface)
                    Text(appState.focusSession.formattedRemaining + " remaining")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(DS.onSurfaceVariant)
                }

                Spacer()

                Button {
                    appState.focusSession.stop()
                } label: {
                    Text("End")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(DS.error)
                        .padding(.horizontal, DS.space10)
                        .padding(.vertical, DS.space4)
                        .background(DS.errorContainer.opacity(0.4), in: Capsule(style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, DS.space20)
            .padding(.vertical, DS.space12)
            .background(
                RoundedRectangle(cornerRadius: DS.radiusXL, style: .continuous)
                    .fill(DS.surfaceBright)
                    .shadow(color: Color.black.opacity(0.4), radius: 20, x: 0, y: 8)
            )
            .padding(.horizontal, DS.space32)
            .padding(.bottom, DS.space20)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
