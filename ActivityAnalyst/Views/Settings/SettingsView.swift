import SwiftUI

/// App settings with sections for permissions, tracking, privacy, and browser integrations.
struct SettingsView: View {
    @StateObject private var viewModel = SettingsViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing24) {
                Text("Settings")
                    .font(Theme.Typography.largeTitle)
                    .foregroundStyle(Theme.Colors.primaryText)

                permissionsSection
                aiSection
                trackingSection
                privacySection
                browserSection
                dataSection
                aboutSection
            }
            .padding(Theme.spacing24)
        }
        .background(Theme.Colors.background)
    }

    // MARK: - Permissions

    private var permissionsSection: some View {
        SettingsSection(title: "Permissions", icon: "lock.shield") {
            ForEach(viewModel.permissions.indices, id: \.self) { index in
                let perm = viewModel.permissions[index]
                HStack {
                    VStack(alignment: .leading, spacing: Theme.spacing2) {
                        Text(perm.name)
                            .font(Theme.Typography.headline)
                        Text(perm.description)
                            .font(Theme.Typography.footnote)
                            .foregroundStyle(Theme.Colors.tertiaryText)
                    }

                    Spacer()

                    statusBadge(for: perm.status)

                    if !perm.status.isUsable {
                        Button("Grant") {
                            viewModel.requestPermission(perm.name)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                .padding(.vertical, Theme.spacing4)
            }
        }
    }

    // MARK: - AI Configuration

    private var aiSection: some View {
        SettingsSection(title: "AI Configuration", icon: "brain.head.profile") {
            VStack(alignment: .leading, spacing: Theme.spacing12) {
                Text("Enter your Anthropic API key to enable AI-powered daily summaries and conversational insights.")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.secondaryText)

                HStack {
                    SecureField("sk-ant-...", text: $viewModel.apiKey)
                        .textFieldStyle(.roundedBorder)

                    Button("Save") {
                        viewModel.saveAPIKey()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.Colors.accent)
                    .disabled(viewModel.apiKey.isEmpty)
                }

                if ServiceContainer.shared.hasAI {
                    Label("AI is configured and available", systemImage: "checkmark.circle.fill")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(.green)
                } else if !viewModel.apiKey.isEmpty {
                    Label("Restart the app after saving to activate AI", systemImage: "arrow.clockwise")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(.orange)
                } else {
                    Label("No API key configured — AI features are disabled", systemImage: "exclamationmark.triangle")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    // MARK: - Tracking

    private var trackingSection: some View {
        SettingsSection(title: "Tracking Rules", icon: "slider.horizontal.3") {
            VStack(alignment: .leading, spacing: Theme.spacing12) {
                SettingsSlider(
                    label: "Minimum app usage",
                    value: Binding(
                        get: { viewModel.preferences.effectiveMinAppUse },
                        set: { viewModel.preferences.minimumAppUseDuration = $0 }
                    ),
                    range: 1...30,
                    unit: "seconds"
                )

                SettingsSlider(
                    label: "Minimum web visit",
                    value: Binding(
                        get: { viewModel.preferences.effectiveMinWebVisit },
                        set: { viewModel.preferences.minimumWebVisitDuration = $0 }
                    ),
                    range: 1...30,
                    unit: "seconds"
                )

                SettingsSlider(
                    label: "Session merge window",
                    value: Binding(
                        get: { viewModel.preferences.effectiveMergeWindow },
                        set: { viewModel.preferences.sessionMergeWindow = $0 }
                    ),
                    range: 1...30,
                    unit: "seconds"
                )

                SettingsSlider(
                    label: "Idle grace period",
                    value: Binding(
                        get: { viewModel.preferences.effectiveIdleGrace },
                        set: { viewModel.preferences.idleGracePeriod = $0 }
                    ),
                    range: 30...600,
                    unit: "seconds"
                )
            }

            Button("Save Tracking Rules") {
                viewModel.savePreferences()
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.Colors.accent)
        }
    }

    // MARK: - Privacy

    private var privacySection: some View {
        SettingsSection(title: "Privacy", icon: "eye.slash") {
            VStack(alignment: .leading, spacing: Theme.spacing12) {
                Picker("Private browsing", selection: $viewModel.preferences.trackPrivateBrowsing) {
                    ForEach(PrivateBrowsingMode.allCases, id: \.self) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                .pickerStyle(.radioGroup)

                Divider()

                HStack {
                    Text("Data retention")
                        .font(Theme.Typography.body)
                    Spacer()
                    Picker("", selection: Binding(
                        get: { viewModel.preferences.effectiveRetentionDays },
                        set: { viewModel.preferences.retentionDays = $0 }
                    )) {
                        Text("30 days").tag(30)
                        Text("90 days").tag(90)
                        Text("180 days").tag(180)
                        Text("1 year").tag(365)
                        Text("Forever").tag(0)
                    }
                    .frame(width: 150)
                }
            }
        }
    }

    // MARK: - Browser Integrations

    private var browserSection: some View {
        SettingsSection(title: "Browser Integrations", icon: "globe") {
            if viewModel.browserIntegrations.isEmpty {
                Text("No browsers detected yet. Start using your browsers to see them here.")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            } else {
                ForEach(viewModel.browserIntegrations) { browser in
                    HStack {
                        Text(browser.name)
                            .font(Theme.Typography.body)

                        Spacer()

                        if browser.extensionInstalled {
                            Label("Connected", systemImage: "checkmark.circle.fill")
                                .font(Theme.Typography.footnote)
                                .foregroundStyle(.green)
                        } else {
                            Label("Extension needed", systemImage: "arrow.down.circle")
                                .font(Theme.Typography.footnote)
                                .foregroundStyle(.orange)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Data

    private var dataSection: some View {
        SettingsSection(title: "Data Management", icon: "externaldrive") {
            HStack(spacing: Theme.spacing12) {
                Button("Export All Data") {
                    Task { await viewModel.exportData() }
                }
                .buttonStyle(.bordered)

                Button("Delete All Data") {
                    Task { await viewModel.deleteAllData() }
                }
                .buttonStyle(.bordered)
                .foregroundStyle(.red)
            }
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        SettingsSection(title: "About", icon: "info.circle") {
            VStack(alignment: .leading, spacing: Theme.spacing4) {
                Text("Activity Analyst v1.0.0")
                    .font(Theme.Typography.body)
                Text("A premium macOS activity intelligence tool.")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.secondaryText)
            }
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func statusBadge(for status: PermissionStatus) -> some View {
        switch status {
        case .granted:
            Label("Granted", systemImage: "checkmark.circle.fill")
                .font(Theme.Typography.footnote)
                .foregroundStyle(.green)
        case .denied:
            Label("Denied", systemImage: "xmark.circle.fill")
                .font(Theme.Typography.footnote)
                .foregroundStyle(.red)
        case .notDetermined:
            Label("Not set", systemImage: "questionmark.circle")
                .font(Theme.Typography.footnote)
                .foregroundStyle(.orange)
        case .restricted:
            Label("Restricted", systemImage: "exclamationmark.triangle")
                .font(Theme.Typography.footnote)
                .foregroundStyle(.gray)
        }
    }
}

// MARK: - Settings Helpers

struct SettingsSection<Content: View>: View {
    let title: String
    let icon: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            HStack(spacing: Theme.spacing6) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.Colors.accent)
                Text(title)
                    .font(Theme.Typography.title3)
                    .foregroundStyle(Theme.Colors.primaryText)
            }

            content()
        }
        .padding(Theme.spacing16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Colors.groupedBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
    }
}

struct SettingsSlider: View {
    let label: String
    @Binding var value: TimeInterval
    let range: ClosedRange<Double>
    let unit: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing4) {
            HStack {
                Text(label)
                    .font(Theme.Typography.body)
                Spacer()
                Text("\(Int(value)) \(unit)")
                    .font(Theme.Typography.monoSmall)
                    .foregroundStyle(Theme.Colors.secondaryText)
            }

            Slider(value: $value, in: range, step: 1)
        }
    }
}
