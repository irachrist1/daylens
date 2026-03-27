import SwiftUI

/// The main two-column app shell.
struct MainShell: View {
    @Environment(AppState.self) private var appState
    @Environment(UpdateChecker.self) private var updateChecker

    private var showsDateNavigation: Bool {
        appState.selectedSection.showsDateNavigation
    }

    var body: some View {
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 200, ideal: DS.sidebarWidth, max: 300)
        } detail: {
            contentView
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .safeAreaInset(edge: .top, spacing: 0) {
                    // Both the update banner and the floating date header live in
                    // the safeAreaInset. This automatically clears the titlebar
                    // and traffic lights when the sidebar is collapsed, and
                    // creates the "floating" effect over scrollable content.
                    // GlassEffectContainer prevents adjacent glass elements from
                    // sampling each other and enables morphing transitions.
                    glassChrome
                }
                .background(DS.surfaceContainer)
                .animation(.easeInOut(duration: 0.22), value: updateChecker.updateAvailable)
        }
        .navigationSplitViewStyle(.balanced)
        .toolbar(removing: .sidebarToggle)
        .preferredColorScheme(appState.colorScheme)
    }

    @ViewBuilder
    private var glassChrome: some View {
        #if compiler(>=6.2)
        if #available(macOS 26, *) {
            GlassEffectContainer {
                chromeStack
            }
        } else {
            chromeStack
        }
        #else
        chromeStack
        #endif
    }

    private var chromeStack: some View {
        VStack(spacing: 0) {
            if updateChecker.updateAvailable {
                UpdateBanner()
                    .padding(.horizontal, DS.space24)
                    .padding(.top, DS.space10)
                    .padding(.bottom, showsDateNavigation ? DS.space8 : DS.space10)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            if showsDateNavigation {
                HeaderBar()
                    .padding(.bottom, DS.space4)
            }
        }
    }

    @ViewBuilder
    private var contentView: some View {
        switch appState.selectedSection {
        case .today:    TodayView()
        case .focus:    FocusView()
        case .history:  HistoryView()
        case .reports:  ReportsView()
        case .apps:     AppsView()
        case .insights: InsightsView()
        case .settings: SettingsView()
        }
    }
}

struct FocusView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = FocusViewModel()
    @State private var focusLabel = ""

    private let refreshTimer = Timer.publish(every: 10, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space24) {
                currentSessionCard
                statsRow
                recentSessionsCard
            }
            .frame(maxWidth: 880, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(DS.space24)
        }
        .background(DS.surfaceContainer)
        .onAppear { viewModel.load() }
        .onReceive(refreshTimer) { _ in
            viewModel.load()
        }
    }

    private var currentSessionCard: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Focus")
                        .font(.system(.title2, design: .default, weight: .bold))
                        .foregroundStyle(DS.onSurface)
                    if appState.focusSession.completedPomodoros > 0 {
                        let n = appState.focusSession.completedPomodoros
                        Text("\(n) pomodoro\(n == 1 ? "" : "s") today")
                            .font(.caption)
                            .foregroundStyle(DS.primary.opacity(0.8))
                    }
                }
                Spacer()
                switch appState.focusSession.phase {
                case .focusing:
                    Button("End Session") {
                        appState.focusSession.stop()
                        viewModel.load()
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(DS.error)
                case .onBreak:
                    Button("Skip Break") { appState.focusSession.skipBreak() }
                        .buttonStyle(.plain)
                        .foregroundStyle(DS.onSurfaceVariant)
                case .idle:
                    EmptyView()
                }
            }

            switch appState.focusSession.phase {
            case .focusing: focusingView
            case .onBreak:  breakView
            case .idle:     idleView
            }
        }
        .cardStyle()
    }

    private var focusingView: some View {
        VStack(alignment: .leading, spacing: DS.space10) {
            Text("Current session")
                .font(.caption.weight(.semibold))
                .foregroundStyle(DS.onSurfaceVariant)

            Text(appState.focusSession.formattedRemaining)
                .font(.system(size: 40, weight: .bold).monospacedDigit())
                .foregroundStyle(DS.onSurface)

            GeometryReader { geometry in
                Capsule()
                    .fill(DS.surfaceHighest)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(DS.primaryGradient)
                            .frame(width: geometry.size.width * appState.focusSession.progress)
                    }
            }
            .frame(height: 8)

            Text("\(appState.focusSession.formattedElapsed) elapsed")
                .font(.caption)
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.7))
        }
    }

    private var breakView: some View {
        VStack(alignment: .leading, spacing: DS.space10) {
            Text("Break time")
                .font(.caption.weight(.semibold))
                .foregroundStyle(DS.secondary)

            Text(appState.focusSession.formattedBreakRemaining)
                .font(.system(size: 40, weight: .bold).monospacedDigit())
                .foregroundStyle(DS.onSurface)

            GeometryReader { geometry in
                Capsule()
                    .fill(DS.surfaceHighest)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(DS.secondary)
                            .frame(width: geometry.size.width * appState.focusSession.breakProgress)
                    }
            }
            .frame(height: 8)

            Text("Take a breather — next session starts when break ends.")
                .font(.caption)
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.7))
        }
    }

    private var idleView: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            VStack(alignment: .leading, spacing: DS.space8) {
                Text("FOCUS LABEL")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(0.5)
                    .foregroundStyle(DS.onSurfaceVariant)

                TextField("What are you focusing on?", text: $focusLabel)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, DS.space12)
                    .padding(.vertical, DS.space10)
                    .background(
                        RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                            .fill(DS.surfaceHighest)
                    )
            }

            // Duration presets
            VStack(alignment: .leading, spacing: DS.space8) {
                Text("DURATION")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(0.5)
                    .foregroundStyle(DS.onSurfaceVariant)

                HStack(spacing: DS.space8) {
                    ForEach([15, 25, 45, 60], id: \.self) { minutes in
                        DurationChip(
                            label: "\(minutes)m",
                            isSelected: appState.focusSession.targetMinutes == minutes
                        ) { appState.focusSession.targetMinutes = minutes }
                    }
                }
            }

            // Break settings
            VStack(alignment: .leading, spacing: DS.space8) {
                HStack {
                    Text("BREAKS")
                        .font(.system(size: 9, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(DS.onSurfaceVariant)
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { appState.focusSession.breaksEnabled },
                        set: { appState.focusSession.breaksEnabled = $0 }
                    ))
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .labelsHidden()
                }

                if appState.focusSession.breaksEnabled {
                    HStack(spacing: DS.space8) {
                        ForEach([5, 10, 15], id: \.self) { minutes in
                            DurationChip(
                                label: "\(minutes)m",
                                isSelected: appState.focusSession.breakMinutes == minutes
                            ) { appState.focusSession.breakMinutes = minutes }
                        }
                    }
                }
            }

            Button {
                appState.focusSession.start(label: focusLabel)
                focusLabel = ""
                viewModel.load()
            } label: {
                HStack(spacing: DS.space8) {
                    Image(systemName: "timer")
                        .font(.system(size: 13, weight: .medium))
                    Text("Start \(appState.focusSession.targetMinutes)m Focus")
                        .font(.system(.subheadline, design: .default, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, DS.space12)
                .background(DS.primary, in: RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    private var statsRow: some View {
        HStack(spacing: DS.space12) {
            StatCard(title: "Focused Time", value: viewModel.totalFocusedTime, icon: "clock.fill", color: DS.primary)
            StatCard(title: "Completed Blocks", value: "\(viewModel.completedCount)", icon: "checkmark.circle.fill", color: DS.tertiary)
            StatCard(title: "Current Streak", value: "\(viewModel.currentStreakDays)d", icon: "flame.fill", color: DS.secondary)
            StatCard(title: "Longest Block", value: viewModel.longestSession, icon: "bolt.fill", color: DS.tertiary)
        }
    }

    private var recentSessionsCard: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Previous Focus Sessions")
                .sectionHeader()

            if viewModel.sessions.isEmpty && !viewModel.isLoading {
                Text("No focus sessions recorded yet.")
                    .font(.body)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
            } else {
                ForEach(viewModel.sessions.prefix(12)) { session in
                    HStack(spacing: DS.space12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(Self.dayFormatter.string(from: session.startTime)) • \(Self.timeFormatter.string(from: session.startTime))")
                                .font(.system(size: 13, weight: .medium).monospacedDigit())
                                .foregroundStyle(DS.onSurface)

                            if let label = session.label, !label.isEmpty {
                                Text(label)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(DS.onSurface)
                                    .lineLimit(1)
                            }

                            Text(statusLabel(for: session))
                                .font(.caption)
                                .foregroundStyle(DS.onSurfaceVariant.opacity(0.65))
                        }

                        Spacer()

                        Text(session.formattedActualDuration)
                            .font(.system(size: 13, weight: .semibold).monospacedDigit())
                            .foregroundStyle(DS.onSurfaceVariant)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .cardStyle()
    }

    private func statusLabel(for session: FocusSessionRecord) -> String {
        let target = "\(session.targetMinutes)m target"
        switch session.status {
        case .running:
            return "Running • \(target)"
        case .completed:
            return "Completed • \(target)"
        case .stopped:
            return "Stopped early • \(target)"
        }
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter
    }()
}

private struct DurationChip: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 12, weight: isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? DS.primary : DS.onSurfaceVariant)
                .padding(.horizontal, DS.space12)
                .padding(.vertical, DS.space6)
                .background(
                    RoundedRectangle(cornerRadius: DS.radiusSmall, style: .continuous)
                        .fill(isSelected ? DS.primary.opacity(0.12) : DS.surfaceHighest.opacity(0.6))
                )
        }
        .buttonStyle(.plain)
    }
}
