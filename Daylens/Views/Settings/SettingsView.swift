import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = SettingsViewModel()
    @State private var showDeleteConfirmation = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space20) {
                profileCard
                appearanceSection
                aiSection
                generalSection
                dataSection
                WebCompanionSection()

                if let status = viewModel.statusMessage {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(DS.tertiary)
                        .transition(.opacity)
                }
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
