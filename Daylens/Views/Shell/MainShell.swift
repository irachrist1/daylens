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
    @AppStorage("daylens.focusIntent") private var focusIntent: String = ""
    @State private var viewModel = FocusViewModel()
    @State private var customMinutes: Int = 30
    @State private var showCustomInput = false

    // Drag-to-create
    @State private var isDraggingGrid = false
    @State private var dragStartY: CGFloat = 0
    @State private var dragCurrentY: CGFloat = 0
    @State private var dragHighlightStartHour: Int? = nil
    @State private var dragHighlightEndHour: Int? = nil

    // Inline create card
    @State private var showingCreateCard = false
    @State private var createStartHour: Int = 9
    @State private var createDurationMins: Int = 60
    @State private var createIntent: String = ""

    // Inline edit card
    @State private var editingSlotID: UUID? = nil
    @State private var editIntent: String = ""
    @State private var editDurationMins: Int = 60

    private let hourHeight: CGFloat = 64
    private let refreshTimer = Timer.publish(every: 10, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 0) {
            intentBar
                .padding(DS.space20)
                .background(DS.surfaceLow)
            Divider()
            timeSlotsSection
        }
        .background(DS.surfaceContainer)
        .onAppear {
            viewModel.sessionManager = appState.focusSession
            viewModel.load()
        }
        .onReceive(refreshTimer) { _ in viewModel.load() }
    }

    // MARK: - Intent bar

    private var intentBar: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            switch appState.focusSession.phase {
            case .focusing:
                activeIntentBar
            case .onBreak:
                breakIntentBar
            case .idle:
                idleIntentBar
            }
        }
    }

    private var idleIntentBar: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack(spacing: DS.space12) {
                TextField("What are you working on?", text: $focusIntent)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14))
                    .padding(.horizontal, DS.space12)
                    .padding(.vertical, DS.space8)
                    .background(DS.surfaceHighest, in: RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous))
                    .frame(maxWidth: .infinity)

                Button {
                    viewModel.startFocusSession(label: focusIntent, durationMinutes: selectedDuration)
                } label: {
                    HStack(spacing: DS.space6) {
                        Image(systemName: "timer")
                            .font(.system(size: 13, weight: .medium))
                        Text("Start \(selectedDuration)m")
                            .font(.system(.subheadline, design: .default, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, DS.space16)
                    .padding(.vertical, DS.space8)
                    .background(DS.primary, in: RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous))
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: DS.space8) {
                ForEach(durationPresets, id: \.label) { preset in
                    DurationChip(
                        label: preset.label,
                        isSelected: isPresetSelected(preset)
                    ) {
                        if preset.label == "Custom" {
                            showCustomInput.toggle()
                        } else {
                            appState.focusSession.targetMinutes = preset.minutes
                            showCustomInput = false
                        }
                    }
                }
                if showCustomInput {
                    HStack(spacing: DS.space4) {
                        TextField("min", value: $customMinutes, format: .number)
                            .textFieldStyle(.plain)
                            .font(.system(size: 12).monospacedDigit())
                            .frame(width: 36)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, DS.space6)
                            .padding(.vertical, DS.space4)
                            .background(DS.surfaceHighest, in: RoundedRectangle(cornerRadius: DS.radiusSmall, style: .continuous))
                            .onChange(of: customMinutes) { _, v in
                                if v > 0 { appState.focusSession.targetMinutes = v }
                            }
                        Text("m")
                            .font(.system(size: 12))
                            .foregroundStyle(DS.onSurfaceVariant)
                    }
                }
            }
        }
    }

    private var activeIntentBar: some View {
        HStack(spacing: DS.space16) {
            VStack(alignment: .leading, spacing: DS.space4) {
                Text(focusIntent.isEmpty ? "Focus session" : focusIntent)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DS.onSurface)
                    .lineLimit(1)
                HStack(spacing: DS.space8) {
                    Text(appState.focusSession.formattedElapsed)
                        .font(.system(size: 28, weight: .bold).monospacedDigit())
                        .foregroundStyle(DS.primary)
                    Text("/ \(appState.focusSession.targetMinutes)m")
                        .font(.system(size: 14))
                        .foregroundStyle(DS.onSurfaceVariant)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: DS.space8) {
                GeometryReader { geo in
                    Capsule()
                        .fill(DS.surfaceHighest)
                        .overlay(alignment: .leading) {
                            Capsule()
                                .fill(DS.primaryGradient)
                                .frame(width: geo.size.width * appState.focusSession.progress)
                        }
                }
                .frame(width: 120, height: 6)
                Button("End Session") {
                    viewModel.endFocusSession()
                    viewModel.load()
                }
                .buttonStyle(.plain)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(DS.error)
            }
        }
        .padding(DS.space4)
    }

    private var breakIntentBar: some View {
        HStack(spacing: DS.space16) {
            VStack(alignment: .leading, spacing: DS.space4) {
                Text("Break time")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DS.secondary)
                Text(appState.focusSession.formattedBreakRemaining)
                    .font(.system(size: 28, weight: .bold).monospacedDigit())
                    .foregroundStyle(DS.onSurface)
            }
            Spacer()
            Button("Skip Break") { appState.focusSession.skipBreak() }
                .buttonStyle(.plain)
                .foregroundStyle(DS.onSurfaceVariant)
        }
        .padding(DS.space4)
    }

    // MARK: - Time slots

    private var timeSlotsSection: some View {
        ScrollView {
            VStack(spacing: 0) {
                ZStack(alignment: .topLeading) {
                    // Hour rows
                    VStack(spacing: 0) {
                        ForEach(workHours, id: \.self) { hour in
                            hourRow(hour: hour)
                            Divider().padding(.leading, 52)
                        }
                    }

                    // Live drag selection highlight
                    if isDraggingGrid {
                        let topY = min(dragStartY, dragCurrentY)
                        let botY = max(dragStartY, dragCurrentY)
                        RoundedRectangle(cornerRadius: DS.radiusSmall, style: .continuous)
                            .fill(DS.primary.opacity(0.12))
                            .overlay(
                                RoundedRectangle(cornerRadius: DS.radiusSmall, style: .continuous)
                                    .strokeBorder(DS.primary.opacity(0.45), lineWidth: 1.5)
                            )
                            .frame(height: max(8, botY - topY))
                            .offset(x: 52, y: topY)
                            .allowsHitTesting(false)
                    }
                }
                .coordinateSpace(name: "timeGrid")
                .contentShape(Rectangle())
                .clipped()
                .onHover { hovering in
                    if hovering { NSCursor.crosshair.push() }
                    else { NSCursor.pop() }
                }
                .simultaneousGesture(
                    DragGesture(minimumDistance: 20, coordinateSpace: .named("timeGrid"))
                        .onChanged { value in
                            let startH = hourFromGridY(value.startLocation.y)
                            guard isFutureHour(startH),
                                  !showingCreateCard,
                                  editingSlotID == nil,
                                  focusSlots(for: startH).isEmpty else { return }
                            isDraggingGrid = true
                            dragStartY = value.startLocation.y
                            dragCurrentY = value.location.y
                            dragHighlightStartHour = min(startH, hourFromGridY(value.location.y))
                            dragHighlightEndHour = max(startH, hourFromGridY(value.location.y))
                        }
                        .onEnded { value in
                            guard isDraggingGrid else { return }
                            isDraggingGrid = false
                            let startH = hourFromGridY(min(value.startLocation.y, value.location.y))
                            guard isFutureHour(startH) else {
                                resetDragState()
                                return
                            }
                            // Snap to 30-minute increments based on drag height
                            let dragHeight = abs(value.location.y - value.startLocation.y)
                            let rawMins = (dragHeight / hourHeight) * 60
                            let snappedMins = max(30, Int((rawMins / 30).rounded()) * 30)
                            createStartHour = startH
                            createDurationMins = snappedMins
                            createIntent = ""
                            showingCreateCard = true
                            dragStartY = 0
                            dragCurrentY = 0
                        }
                )

                // Stats + history below the time grid
                statsAndHistorySection
                    .padding(.horizontal, DS.space20)
                    .padding(.top, DS.space24)
                    .padding(.bottom, DS.space20)
            }
        }
        .scrollDisabled(isDraggingGrid)
    }

    private func hourRow(hour: Int) -> some View {
        let isPast = isPastHour(hour)
        let hourBlocks = blocks(for: hour)
        let hourSlots = focusSlots(for: hour)
        let showCreate = showingCreateCard && createStartHour == hour
        let inDragHighlight = isDraggingGrid &&
            (dragHighlightStartHour ?? Int.min) <= hour &&
            hour <= (dragHighlightEndHour ?? Int.min)

        return HStack(alignment: .top, spacing: 0) {
            // Hour label
            Text(hourLabel(hour))
                .font(.system(size: 11, weight: .medium).monospacedDigit())
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
                .frame(width: 44, alignment: .trailing)
                .padding(.top, DS.space6)
                .padding(.trailing, DS.space8)

            // Content area
            ZStack(alignment: .topLeading) {
                Rectangle()
                    .fill(Color.clear)
                    .frame(maxWidth: .infinity, minHeight: hourHeight)

                // Subtle drag highlight for this row
                if inDragHighlight {
                    RoundedRectangle(cornerRadius: DS.radiusSmall)
                        .fill(DS.primary.opacity(0.07))
                        .frame(maxWidth: .infinity)
                        .allowsHitTesting(false)
                } else if !isPast && hourBlocks.isEmpty && hourSlots.isEmpty && !showCreate {
                    // Subtle dotted border on empty future hours — no text
                    RoundedRectangle(cornerRadius: DS.radiusSmall, style: .continuous)
                        .strokeBorder(
                            DS.onSurfaceVariant.opacity(0.12),
                            style: StrokeStyle(lineWidth: 1, dash: [4, 4])
                        )
                        .frame(maxWidth: .infinity, minHeight: hourHeight - 8)
                        .allowsHitTesting(false)
                }

                // WorkContextBlocks starting in this hour
                VStack(spacing: 2) {
                    ForEach(hourBlocks) { block in
                        TimelineBlock(block: block, hourHeight: hourHeight)
                    }
                }

                // Planned FocusSlots or their edit cards
                VStack(spacing: 2) {
                    ForEach(hourSlots) { slot in
                        if editingSlotID == slot.id {
                            inlineEditCard(for: slot)
                                .padding(.vertical, 2)
                        } else {
                            FocusSlotView(slot: slot) {
                                editingSlotID = slot.id
                                editIntent = slot.intent
                                editDurationMins = slot.durationMinutes
                            } onDelete: {
                                viewModel.deleteFocusSlot(id: slot.id)
                            } onStartNow: {
                                focusIntent = slot.intent
                                appState.focusSession.targetMinutes = slot.durationMinutes
                                viewModel.startFocusSession(label: slot.intent, durationMinutes: slot.durationMinutes)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }

                // Inline create card shown at the drag start hour
                if showCreate {
                    inlineCreateCard()
                        .padding(.vertical, 2)
                }
            }
            .frame(maxWidth: .infinity, minHeight: hourHeight)
            .padding(.horizontal, DS.space12)
            .padding(.vertical, DS.space4)
        }
        .frame(minHeight: hourHeight)
        .contentShape(Rectangle())
    }

    // MARK: - Inline create card

    @ViewBuilder
    private func inlineCreateCard() -> some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            TextField("What will you work on?", text: $createIntent)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 13))

            HStack(spacing: DS.space8) {
                Text(formatDurationMins(createDurationMins))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DS.onSurface)
                    .frame(minWidth: 40)
                Stepper("", value: $createDurationMins, in: 30...480, step: 30)
                    .labelsHidden()
                Spacer()
            }

            HStack(spacing: DS.space8) {
                Button("Save") { saveNewSlot() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(createIntent.trimmingCharacters(in: .whitespaces).isEmpty)

                Button("Cancel") {
                    showingCreateCard = false
                    resetDragState()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .padding(DS.space12)
        .background(DS.surfaceContainer, in: RoundedRectangle(cornerRadius: DS.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DS.radiusMedium)
                .strokeBorder(DS.primary.opacity(0.35), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.07), radius: 6, y: 2)
    }

    private func saveNewSlot() {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        if let start = calendar.date(byAdding: .hour, value: createStartHour, to: today) {
            let slot = FocusSlot(
                id: UUID(),
                slotStart: start,
                durationMinutes: createDurationMins,
                intent: createIntent.trimmingCharacters(in: .whitespaces)
            )
            viewModel.saveFocusSlot(slot)
        }
        showingCreateCard = false
        resetDragState()
    }

    // MARK: - Inline edit card

    @ViewBuilder
    private func inlineEditCard(for slot: FocusSlot) -> some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            TextField("What are you working on?", text: $editIntent)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 13))

            HStack(spacing: DS.space8) {
                Text(formatDurationMins(editDurationMins))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DS.onSurface)
                    .frame(minWidth: 40)
                Stepper("", value: $editDurationMins, in: 30...480, step: 30)
                    .labelsHidden()
                Spacer()
            }

            HStack(spacing: DS.space8) {
                Button {
                    focusIntent = editIntent
                    appState.focusSession.targetMinutes = editDurationMins
                    viewModel.startFocusSession(label: editIntent, durationMinutes: editDurationMins)
                    editingSlotID = nil
                } label: {
                    Label("Start Now", systemImage: "timer")
                        .font(.system(size: 12))
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)

                Spacer()

                Button("Delete") {
                    viewModel.deleteFocusSlot(id: slot.id)
                    editingSlotID = nil
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
                .foregroundStyle(DS.error)

                Button("Save") {
                    let updated = FocusSlot(
                        id: slot.id,
                        slotStart: slot.slotStart,
                        durationMinutes: editDurationMins,
                        intent: editIntent.trimmingCharacters(in: .whitespaces)
                    )
                    viewModel.saveFocusSlot(updated)
                    editingSlotID = nil
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(editIntent.trimmingCharacters(in: .whitespaces).isEmpty)

                Button("Cancel") { editingSlotID = nil }
                    .buttonStyle(.borderless)
                    .controlSize(.small)
            }
        }
        .padding(DS.space12)
        .background(DS.surfaceContainer, in: RoundedRectangle(cornerRadius: DS.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DS.radiusMedium)
                .strokeBorder(DS.primary.opacity(0.35), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.07), radius: 6, y: 2)
    }

    // MARK: - Stats + history

    private var statsAndHistorySection: some View {
        VStack(alignment: .leading, spacing: DS.space20) {
            // Stats row
            HStack(spacing: DS.space12) {
                StatCard(title: "Focused Time", value: viewModel.totalFocusedTime, icon: "clock.fill", color: DS.primary)
                StatCard(title: "Completed Blocks", value: "\(viewModel.completedCount)", icon: "checkmark.circle.fill", color: DS.tertiary)
                StatCard(title: "Current Streak", value: "\(viewModel.currentStreakDays)d", icon: "flame.fill", color: DS.secondary)
                StatCard(title: "Longest Block", value: viewModel.longestSession, icon: "bolt.fill", color: DS.tertiary)
            }

            // Recent sessions
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
                                Text(sessionStatusLabel(for: session))
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
    }

    // MARK: - Helpers

    private var workHours: [Int] {
        Array(viewModel.workHoursStart..<viewModel.workHoursEnd)
    }

    private func hourFromGridY(_ y: CGFloat) -> Int {
        let index = max(0, Int(y / hourHeight))
        return max(viewModel.workHoursStart, min(viewModel.workHoursEnd - 1, viewModel.workHoursStart + index))
    }

    private func isFutureHour(_ hour: Int) -> Bool {
        !isPastHour(hour)
    }

    private func isPastHour(_ hour: Int) -> Bool {
        let cal = Calendar.current
        let now = Date()
        let currentHour = cal.component(.hour, from: now)
        let isToday = cal.isDateInToday(Date())
        return isToday ? hour < currentHour : true
    }

    private func blocks(for hour: Int) -> [WorkContextBlock] {
        viewModel.workContextBlocks.filter { block in
            Calendar.current.component(.hour, from: block.startTime) == hour
        }
    }

    private func focusSlots(for hour: Int) -> [FocusSlot] {
        viewModel.focusSlots.filter { slot in
            Calendar.current.component(.hour, from: slot.slotStart) == hour
        }
    }

    private func resetDragState() {
        dragHighlightStartHour = nil
        dragHighlightEndHour = nil
    }

    private func formatDurationMins(_ mins: Int) -> String {
        if mins < 60 { return "\(mins)m" }
        let h = mins / 60, m = mins % 60
        return m > 0 ? "\(h)h \(m)m" : "\(h)h"
    }

    private var durationPresets: [(label: String, minutes: Int)] {
        [(label: "25m", minutes: 25), (label: "45m", minutes: 45),
         (label: "60m", minutes: 60), (label: "90m", minutes: 90),
         (label: "Custom", minutes: -1)]
    }

    private var selectedDuration: Int {
        showCustomInput ? customMinutes : appState.focusSession.targetMinutes
    }

    private func isPresetSelected(_ preset: (label: String, minutes: Int)) -> Bool {
        if preset.label == "Custom" { return showCustomInput }
        return !showCustomInput && appState.focusSession.targetMinutes == preset.minutes
    }

    private func hourLabel(_ hour: Int) -> String {
        let h = hour == 0 ? 12 : (hour > 12 ? hour - 12 : hour)
        let period = hour < 12 ? "AM" : "PM"
        return "\(h)\(period)"
    }

    private func sessionStatusLabel(for session: FocusSessionRecord) -> String {
        let target = "\(session.targetMinutes)m target"
        switch session.status {
        case .running:   return "Running • \(target)"
        case .completed: return "Completed • \(target)"
        case .stopped:   return "Stopped early • \(target)"
        }
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "EEE, MMM d"; return f
    }()

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter(); f.timeStyle = .short; return f
    }()
}

// MARK: - Focus Slot view chip

private struct FocusSlotView: View {
    let slot: FocusSlot
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onStartNow: () -> Void

    var body: some View {
        HStack(spacing: DS.space8) {
            Rectangle()
                .fill(DS.primary)
                .frame(width: 3)
                .clipShape(Capsule())

            VStack(alignment: .leading, spacing: 2) {
                Text(slot.intent)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DS.onSurface)
                    .lineLimit(1)
                Text("\(slot.durationMinutes >= 60 ? "\(slot.durationMinutes / 60)h" : "\(slot.durationMinutes)m") planned")
                    .font(.system(size: 11))
                    .foregroundStyle(DS.primary.opacity(0.7))
            }

            Spacer()

            Button(action: onDelete) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, DS.space10)
        .padding(.vertical, DS.space8)
        .background(DS.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                .strokeBorder(DS.primary.opacity(0.18), lineWidth: 0.5)
        )
        .contextMenu {
            Button { onEdit() } label: {
                Label("Edit Slot", systemImage: "pencil")
            }
            Button { onStartNow() } label: {
                Label("Start Focus Now", systemImage: "play.fill")
            }
            Divider()
            Button(role: .destructive) { onDelete() } label: {
                Label("Delete Slot", systemImage: "trash")
            }
        }
    }
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
