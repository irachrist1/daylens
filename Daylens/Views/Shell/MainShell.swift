import SwiftUI

/// The main two-column app shell.
struct MainShell: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 200, ideal: DS.sidebarWidth, max: 300)
        } detail: {
            VStack(spacing: 0) {
                if appState.selectedSection.showsDateNavigation {
                    HeaderBar()
                }
                contentView
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(DS.surfaceContainer)
            }
            .overlay(alignment: .bottom) {
                FocusSessionBar()
                    .animation(.spring(response: 0.35, dampingFraction: 0.8), value: appState.focusSession.isRunning)
            }
        }
        .navigationSplitViewStyle(.balanced)
        .toolbar(removing: .sidebarToggle)
        .preferredColorScheme(appState.colorScheme)
    }

    @ViewBuilder
    private var contentView: some View {
        switch appState.selectedSection {
        case .today:    TodayView()
        case .history:  HistoryView()
        case .apps:     AppsView()
        case .insights: InsightsView()
        case .settings: SettingsView()
        }
    }
}

// MARK: - Focus Session Bar

private struct FocusSessionBar: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        if appState.focusSession.isRunning {
            HStack(spacing: DS.space12) {
                Circle()
                    .fill(DS.primary)
                    .frame(width: 7, height: 7)
                    .shadow(color: DS.primary.opacity(0.6), radius: 4)

                Text("DEEP FOCUS")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(DS.onSurfaceVariant)

                Text(appState.focusSession.formattedRemaining)
                    .font(.system(size: 13, weight: .semibold).monospacedDigit())
                    .foregroundStyle(DS.primary)

                // Progress bar
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(DS.surfaceHighest)
                        Capsule()
                            .fill(DS.primary)
                            .frame(width: geo.size.width * appState.focusSession.progress)
                    }
                }
                .frame(height: 4)

                Button {
                    appState.focusSession.stop()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(DS.onSurfaceVariant)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, DS.space20)
            .padding(.vertical, DS.space10)
            .background(DS.surfaceContainer)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(DS.surfaceHighest.opacity(0.5))
                    .frame(height: 1)
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
