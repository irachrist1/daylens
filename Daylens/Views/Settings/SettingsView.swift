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

                generalSection

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

    // MARK: - AI

    private var aiSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("AI")
                .sectionHeader()

            VStack(alignment: .leading, spacing: DS.space8) {
                Text("API Key")
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

                Text("Used for AI-powered insights. Stored locally on your Mac.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
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
                    Text("Start tracking when you log in")
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

    // MARK: - Data

    private var dataSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Data")
                .sectionHeader()

            HStack {
                VStack(alignment: .leading, spacing: DS.space2) {
                    Text("Keep Data For")
                        .font(.body.weight(.medium))
                    Text("Older data is deleted automatically")
                        .font(.caption)
                        .foregroundStyle(.secondary)
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

            Divider()

            HStack {
                Text("Export Data")
                    .font(.body.weight(.medium))
                Spacer()
                Button("Export JSON") {
                    viewModel.exportData()
                }
                .buttonStyle(.bordered)
            }

            Divider()

            HStack {
                Text("Delete All Data")
                    .font(.body.weight(.medium))
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
    }
}
