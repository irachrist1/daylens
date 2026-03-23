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
        HStack(spacing: 0) {
            navigationButton(symbol: "chevron.left", help: "Previous day", action: appState.goToPreviousDay)
            separator

            Button(action: appState.goToToday) {
                Text(dateLabel)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(appState.isToday ? DS.primary : DS.onSurface)
                    .lineLimit(1)
                    .padding(.horizontal, DS.space12)
                    .frame(minWidth: 96)
                    .frame(height: 28)
                    .contentShape(Capsule())
                    .animation(.easeInOut(duration: 0.2), value: appState.isToday)
            }
            .buttonStyle(.plain)
            .help("Go to today")

            separator
            navigationButton(symbol: "chevron.right", help: "Next day", disabled: appState.isToday, action: appState.goToNextDay)
        }
        .padding(.horizontal, DS.space8)
        .padding(.vertical, DS.space6)
        .modifier(LiquidGlassCapsule())
    }

    private var separator: some View {
        Rectangle()
            .fill(Color.white.opacity(0.12))
            .frame(width: 1, height: 16)
            .padding(.horizontal, DS.space4)
    }

    private func navigationButton(
        symbol: String,
        help: String,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(disabled ? DS.onSurfaceVariant.opacity(0.35) : DS.onSurface)
                .frame(width: 28, height: 28)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .help(help)
    }
}

// MARK: - Liquid Glass modifiers (macOS 26+ with pre-Tahoe fallback)

/// Capsule-shaped liquid glass for floating controls like the date navigator.
private struct LiquidGlassCapsule: ViewModifier {
    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(macOS 26, *) {
            content
                .glassEffect(.regular.interactive(), in: .capsule)
        } else {
            fallbackCapsule(content)
        }
        #else
        fallbackCapsule(content)
        #endif
    }

    private func fallbackCapsule(_ content: Content) -> some View {
        content
            .background {
                Capsule(style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay {
                        Capsule(style: .continuous)
                            .fill(
                                LinearGradient(
                                    colors: [
                                        Color.white.opacity(0.18),
                                        DS.primary.opacity(0.08),
                                        Color.clear
                                    ],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                    }
                    .overlay {
                        Capsule(style: .continuous)
                            .strokeBorder(Color.white.opacity(0.22), lineWidth: 1)
                    }
                    .overlay(alignment: .top) {
                        Capsule(style: .continuous)
                            .stroke(Color.white.opacity(0.28), lineWidth: 0.8)
                            .blur(radius: 0.6)
                            .mask {
                                Rectangle()
                                    .frame(height: 14)
                            }
                    }
            }
            .shadow(color: Color.black.opacity(0.18), radius: 18, x: 0, y: 10)
            .shadow(color: Color.white.opacity(0.05), radius: 2, x: 0, y: 1)
    }
}

