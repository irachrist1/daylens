import SwiftUI
import UserNotifications

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = SettingsViewModel()
    @State private var showDeleteConfirmation = false
    @State private var showProfileEdit = false

    @AppStorage("daylens.notifications.dailyDigest") private var dailyDigestEnabled = false
    @AppStorage("daylens.notifications.focusNudge") private var focusNudgeEnabled = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space20) {
                profileCard
                profileSection
                appearanceSection
                aiSection
                generalSection
                notificationsSection
                dataSection
                PrivacySection()
                WebCompanionSection()

                if let status = viewModel.statusMessage {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(DS.tertiary)
                        .transition(.opacity)
                }

                Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown")")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, DS.space8)
            }
            .padding(DS.space24)
        }
        .background(DS.surfaceContainer)
        .onAppear {
            viewModel.loadSettings(aiService: appState.aiService)
        }
    }

    // MARK: - Profile Card

    private var profileCard: some View {
        HStack(spacing: DS.space16) {
            ZStack {
                Circle()
                    .fill(DS.primaryContainer)
                    .frame(width: 52, height: 52)
                Text(String(appState.userName.prefix(1)).uppercased())
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: DS.space4) {
                Text(appState.userName)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(DS.onSurface)
                HStack(spacing: DS.space8) {
                    Label("Pro Plan", systemImage: "checkmark.seal.fill")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(DS.primary)
                }
            }
            Spacer()
        }
        .cardStyle()
    }

    // MARK: - Profile

    @State private var profileSummary: UserProfile? = nil

    private var profileSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack {
                Text("Profile")
                    .sectionHeader()
                Spacer()
                Button("Edit") { showProfileEdit = true }
                    .buttonStyle(.bordered)
                    .sheet(isPresented: $showProfileEdit, onDismiss: { loadProfileSummary() }) {
                        ProfileEditSheet()
                            .environment(appState)
                    }
            }

            if let p = profileSummary, !p.role.isEmpty {
                HStack(spacing: DS.space8) {
                    // Role chip
                    Text(p.role.capitalized)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(DS.primary)
                        .padding(.horizontal, DS.space8)
                        .padding(.vertical, DS.space4)
                        .background(DS.primaryContainer.opacity(0.4), in: Capsule())
                        .overlay(Capsule().stroke(DS.primary.opacity(0.4), lineWidth: 1))

                    // Goal chips
                    let goals = p.goals.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                    ForEach(goals, id: \.self) { goal in
                        Text(goal)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(DS.onSurfaceVariant)
                            .padding(.horizontal, DS.space8)
                            .padding(.vertical, DS.space4)
                            .background(DS.surfaceHighest, in: Capsule())
                            .overlay(Capsule().stroke(DS.outlineVariant, lineWidth: 1))
                    }
                }
            } else {
                Text("No profile set up yet.")
                    .font(.callout)
                    .foregroundStyle(DS.onSurfaceVariant)
            }
        }
        .cardStyle()
        .onAppear { loadProfileSummary() }
    }

    private func loadProfileSummary() {
        let db = appState.database!
        Task.detached {
            let p = try? db.fetchUserProfile()
            await MainActor.run { profileSummary = p }
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Appearance")
                .sectionHeader()

            HStack {
                Text("Color Scheme")
                    .font(.body.weight(.medium))
                    .foregroundStyle(DS.onSurface)
                Spacer()
                Picker("", selection: Binding(
                    get: {
                        switch appState.colorScheme {
                        case .dark: return "dark"
                        case .light: return "light"
                        default: return "system"
                        }
                    },
                    set: { val in
                        appState.colorScheme = val == "dark" ? .dark : val == "light" ? .light : nil
                    }
                )) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented)
                .frame(width: 200)
            }
            .cardStyle()
        }
    }

    // MARK: - AI

    private var aiSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("AI")
                .sectionHeader()

            VStack(alignment: .leading, spacing: DS.space8) {
                Text("API Key")
                    .font(.body.weight(.medium))
                    .foregroundStyle(DS.onSurface)

                HStack {
                    if viewModel.isAPIKeyVisible {
                        TextField("sk-ant-...", text: $viewModel.apiKey)
                            .textFieldStyle(.roundedBorder)
                    } else {
                        SecureField("sk-ant-...", text: $viewModel.apiKey)
                            .textFieldStyle(.roundedBorder)
                    }

                    Button {
                        viewModel.isAPIKeyVisible.toggle()
                    } label: {
                        Image(systemName: viewModel.isAPIKeyVisible ? "eye.slash" : "eye")
                            .foregroundStyle(DS.onSurfaceVariant)
                    }
                    .buttonStyle(.borderless)

                    Button("Save") {
                        viewModel.saveAPIKey(aiService: appState.aiService)
                    }
                    .buttonStyle(.bordered)
                }

                Text("Used for AI-powered insights. Stored locally on your Mac.")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
            }
            .cardStyle()
        }
    }

    // MARK: - General

    private var generalSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("General")
                .sectionHeader()

            HStack {
                VStack(alignment: .leading, spacing: DS.space2) {
                    Text("Open at Login")
                        .font(.body.weight(.medium))
                        .foregroundStyle(DS.onSurface)
                    Text("Start tracking when you log in")
                        .font(.caption)
                        .foregroundStyle(DS.onSurfaceVariant)
                }
                Spacer()
                Toggle("", isOn: Binding(
                    get: { appState.permissionManager?.isLoginItemEnabled ?? false },
                    set: { enabled in
                        if enabled {
                            appState.permissionManager?.enableLoginItem()
                        } else {
                            appState.permissionManager?.disableLoginItem()
                        }
                    }
                ))
                .labelsHidden()
            }
            .cardStyle()
        }
    }

    // MARK: - Notifications

    private var notificationsSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Notifications")
                .sectionHeader()

            VStack(spacing: DS.space12) {
                HStack {
                    VStack(alignment: .leading, spacing: DS.space2) {
                        Text("Daily Digest")
                            .font(.body.weight(.medium))
                            .foregroundStyle(DS.onSurface)
                        Text("Summary notification at 6 PM each day")
                            .font(.caption)
                            .foregroundStyle(DS.onSurfaceVariant)
                    }
                    Spacer()
                    Toggle("", isOn: $dailyDigestEnabled)
                        .labelsHidden()
                        .onChange(of: dailyDigestEnabled) { _, enabled in
                            Task { @MainActor in
                                let granted = await NotificationService.shared.requestPermission()
                                if granted && enabled {
                                    NotificationService.shared.scheduleDailyDigest()
                                } else if !enabled {
                                    UNUserNotificationCenter.current()
                                        .removePendingNotificationRequests(withIdentifiers: ["daylens.notification.daily_digest"])
                                }
                            }
                        }
                }

                Divider()

                HStack {
                    VStack(alignment: .leading, spacing: DS.space2) {
                        Text("Focus Nudge")
                            .font(.body.weight(.medium))
                            .foregroundStyle(DS.onSurface)
                        Text("Alert when context-switching too often")
                            .font(.caption)
                            .foregroundStyle(DS.onSurfaceVariant)
                    }
                    Spacer()
                    Toggle("", isOn: $focusNudgeEnabled)
                        .labelsHidden()
                }

                Divider()

                HStack {
                    VStack(alignment: .leading, spacing: DS.space2) {
                        Button("Send Test Notification") {
                            sendTestNotification()
                        }
                        .buttonStyle(.bordered)

                        Text("If no notification appears, open System Settings → Notifications → Daylens and enable alerts.")
                            .font(.caption)
                            .foregroundStyle(DS.onSurfaceVariant.opacity(0.7))
                    }
                    Spacer()
                }
            }
            .cardStyle()
        }
    }

    private func sendTestNotification() {
        Task { @MainActor in
            let granted = await NotificationService.shared.requestPermission()
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = "Daylens Test"
            content.body = "Notifications are working correctly."
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 3, repeats: false)
            let request = UNNotificationRequest(
                identifier: "daylens.test.\(UUID().uuidString)",
                content: content,
                trigger: trigger
            )
            try? await UNUserNotificationCenter.current().add(request)
        }
    }

    // MARK: - Data

    private var dataSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Data")
                .sectionHeader()

            VStack(spacing: DS.space12) {
                HStack {
                    VStack(alignment: .leading, spacing: DS.space2) {
                        Text("Keep Data For")
                            .font(.body.weight(.medium))
                            .foregroundStyle(DS.onSurface)
                        Text("Older data is deleted automatically")
                            .font(.caption)
                            .foregroundStyle(DS.onSurfaceVariant)
                    }
                    Spacer()
                    Picker("", selection: $viewModel.retentionDays) {
                        Text("30 days").tag(30)
                        Text("60 days").tag(60)
                        Text("90 days").tag(90)
                        Text("180 days").tag(180)
                        Text("1 year").tag(365)
                    }
                    .labelsHidden()
                    .frame(width: 120)

                    Button("Apply") {
                        viewModel.applyRetention()
                    }
                    .buttonStyle(.bordered)
                }

                HStack {
                    Text("Export Data")
                        .font(.body.weight(.medium))
                        .foregroundStyle(DS.onSurface)
                    Spacer()
                    Button("Export JSON") {
                        viewModel.exportData()
                    }
                    .buttonStyle(.bordered)
                }

                HStack {
                    Text("Delete All Data")
                        .font(.body.weight(.medium))
                        .foregroundStyle(DS.onSurface)
                    Spacer()
                    Button("Delete", role: .destructive) {
                        showDeleteConfirmation = true
                    }
                    .buttonStyle(.bordered)
                }
                .alert("Delete All Data?", isPresented: $showDeleteConfirmation) {
                    Button("Cancel", role: .cancel) {}
                    Button("Delete Everything", role: .destructive) {
                        viewModel.clearAllData()
                    }
                } message: {
                    Text("This permanently removes all tracked activity. This cannot be undone.")
                }
            }
            .cardStyle()
        }
    }
}
