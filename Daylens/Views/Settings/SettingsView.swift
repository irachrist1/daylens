import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = SettingsViewModel()
    @State private var showDeleteConfirmation = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space24) {
                aiSection

                Divider()

                loginSection

                Divider()

                dataSection

                if let status = viewModel.statusMessage {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(.green)
                        .transition(.opacity)
                }
            }
            .padding(DS.space24)
        }
        .onAppear {
            viewModel.loadSettings(aiService: appState.aiService)
        }
    }

    // MARK: - AI Settings

    private var aiSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("AI Settings")
                .sectionHeader()

            VStack(alignment: .leading, spacing: DS.space8) {
                Text("Anthropic API Key")
                    .font(.body.weight(.medium))

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
                    }
                    .buttonStyle(.borderless)

                    Button("Save") {
                        viewModel.saveAPIKey(aiService: appState.aiService)
                    }
                    .buttonStyle(.bordered)
                }

                Text("Your API key is stored securely in the macOS Keychain.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            VStack(alignment: .leading, spacing: DS.space4) {
                Text("AI Model")
                    .font(.body.weight(.medium))

                Picker("Model", selection: $viewModel.selectedModel) {
                    ForEach(viewModel.availableModels, id: \.0) { model in
                        Text(model.1).tag(model.0)
                    }
                }
                .labelsHidden()
                .onChange(of: viewModel.selectedModel) { _, newModel in
                    appState.aiService.setModel(newModel)
                }
            }
        }
    }

    // MARK: - Login Item

    private var loginSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("General")
                .sectionHeader()

            HStack {
                VStack(alignment: .leading, spacing: DS.space2) {
                    Text("Open at Login")
                        .font(.body.weight(.medium))
                    Text("Start tracking automatically when you log in")
                        .font(.caption)
                        .foregroundStyle(.secondary)
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
        }
    }

    // MARK: - Data Management

    private var dataSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Data Management")
                .sectionHeader()

            HStack {
                VStack(alignment: .leading, spacing: DS.space2) {
                    Text("Data Retention")
                        .font(.body.weight(.medium))
                    Text("Delete data older than this many days")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Picker("", selection: $viewModel.retentionDays) {
                    Text("30 days").tag(30)
                    Text("60 days").tag(60)
                    Text("90 days").tag(90)
                    Text("180 days").tag(180)
                    Text("365 days").tag(365)
                }
                .labelsHidden()
                .frame(width: 120)

                Button("Apply") {
                    viewModel.applyRetention()
                }
                .buttonStyle(.bordered)
            }

            Divider()

            HStack {
                VStack(alignment: .leading, spacing: DS.space2) {
                    Text("Export Data")
                        .font(.body.weight(.medium))
                    Text("Export all tracked data as JSON")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Export JSON") {
                    viewModel.exportData()
                }
                .buttonStyle(.bordered)
            }

            Divider()

            HStack {
                VStack(alignment: .leading, spacing: DS.space2) {
                    Text("Delete All Data")
                        .font(.body.weight(.medium))
                    Text("Permanently remove all tracked data")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Delete All Data", role: .destructive) {
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
                Text("This will permanently remove all tracked activity data. This action cannot be undone.")
            }
        }
    }
}
