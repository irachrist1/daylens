import SwiftUI

struct SettingsView: View {
    @Environment(\.appEnvironment) private var env

    var body: some View {
        TabView {
            GeneralSettingsView()
                .tabItem { Label("General", systemImage: "gearshape") }

            AISettingsView()
                .tabItem { Label("AI", systemImage: "sparkles") }

            PrivacySettingsView()
                .tabItem { Label("Privacy", systemImage: "hand.raised") }

            ExtensionSettingsView()
                .tabItem { Label("Browser Extensions", systemImage: "safari") }
        }
        .frame(minWidth: 480)
        .navigationTitle("Settings")
    }
}

// MARK: - General

struct GeneralSettingsView: View {
    @Environment(\.appEnvironment) private var env

    var body: some View {
        Form {
            Section("Tracking") {
                Toggle("Enable tracking", isOn: Binding(
                    get: { !env.settings.isTrackingPaused },
                    set: { enabled in
                        env.settings.isTrackingPaused = !enabled
                        if enabled { env.startCapture() } else { env.pauseCapture() }
                        env.saveSettings()
                    }
                ))
                .help("Pause to stop all data collection temporarily.")

                LabeledContent("Minimum session length") {
                    Stepper(
                        "\(Int(env.settings.minimumSessionSeconds))s",
                        value: Binding(
                            get: { env.settings.minimumSessionSeconds },
                            set: { v in env.settings.minimumSessionSeconds = v; env.saveSettings() }
                        ),
                        in: 1...30
                    )
                }
                .help("Sessions shorter than this are recorded but excluded from dashboard summaries.")

                LabeledContent("Idle detection after") {
                    Stepper(
                        "\(Int(env.settings.idleGraceSeconds))s",
                        value: Binding(
                            get: { env.settings.idleGraceSeconds },
                            set: { v in env.settings.idleGraceSeconds = v; env.saveSettings() }
                        ),
                        in: 30...600, step: 30
                    )
                }
            }

            Section("Data") {
                LabeledContent("Keep data for") {
                    Picker("", selection: Binding(
                        get: { env.settings.retentionPeriod },
                        set: { v in env.settings.retentionPeriod = v; env.saveSettings() }
                    )) {
                        ForEach(RetentionPeriod.allCases, id: \.self) { period in
                            Text(period.displayName).tag(period)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(width: 150)
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

// MARK: - AI

struct AISettingsView: View {
    @Environment(\.appEnvironment) private var env
    @State private var isGenerating = false
    @State private var lastResult = ""

    var body: some View {
        Form {
            Section("Anthropic API Key") {
                SecureField("sk-ant-…", text: Binding(
                    get: { env.settings.anthropicApiKey },
                    set: { v in env.settings.anthropicApiKey = v; env.saveSettings() }
                ))
                .help("Your Anthropic API key. Used only to call the Claude AI for summaries and Q&A.")

                Text("Get your key at console.anthropic.com")
                    .font(DLTypography.caption)
                    .foregroundColor(.secondary)
            }

            Section("Model") {
                Picker("AI Model", selection: Binding(
                    get: { env.settings.selectedAIModel },
                    set: { v in env.settings.selectedAIModel = v; env.saveSettings() }
                )) {
                    ForEach(AIModel.allCases, id: \.self) { model in
                        Text(model.displayName).tag(model)
                    }
                }
                .pickerStyle(.radioGroup)
            }

            Section("Generate Summary") {
                HStack {
                    Button("Generate today's summary now") {
                        Task { await generateSummary() }
                    }
                    .disabled(isGenerating || env.settings.anthropicApiKey.isEmpty)

                    if isGenerating { ProgressView().scaleEffect(0.8) }
                }

                if !lastResult.isEmpty {
                    Text(lastResult)
                        .font(DLTypography.caption)
                        .foregroundColor(lastResult.hasPrefix("Error") ? .red : .secondary)
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }

    @MainActor
    private func generateSummary() async {
        isGenerating = true
        lastResult = ""
        do {
            let dateKey = AppSession.makeDateKey(from: Date().timeIntervalSince1970)
            _ = try await env.summaryGenerator.generateSummary(for: dateKey)
            lastResult = "Summary generated successfully."
        } catch {
            lastResult = "Error: \(error.localizedDescription)"
        }
        isGenerating = false
    }
}

// MARK: - Privacy

struct PrivacySettingsView: View {
    @Environment(\.appEnvironment) private var env
    @State private var showDeleteConfirm = false

    var body: some View {
        Form {
            Section("Private Browsing") {
                Picker("When in private/incognito mode", selection: Binding(
                    get: { env.settings.privateBrowsingBehavior },
                    set: { v in env.settings.privateBrowsingBehavior = v; env.saveSettings() }
                )) {
                    ForEach(PrivateBrowsingBehavior.allCases, id: \.self) { b in
                        Text(b.displayName).tag(b)
                    }
                }
                .pickerStyle(.radioGroup)
            }

            Section("Export & Delete") {
                Button("Export all data as JSON…") {
                    exportData()
                }

                Button("Delete all tracked data…") {
                    showDeleteConfirm = true
                }
                .foregroundColor(.red)
            }

            Section("What DayLens does NOT collect") {
                bulletPoint("Keystrokes or typed content")
                bulletPoint("Screenshots or screen recordings")
                bulletPoint("Passwords or form data")
                bulletPoint("File or document contents")
                bulletPoint("Microphone or camera access")
            }
        }
        .formStyle(.grouped)
        .padding()
        .alert("Delete all data?", isPresented: $showDeleteConfirm) {
            Button("Delete", role: .destructive) {
                try? env.activityRepo.deleteAllData()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will permanently delete all tracked activity, sessions, and AI summaries. This cannot be undone.")
        }
    }

    private func bulletPoint(_ text: String) -> some View {
        Label(text, systemImage: "xmark.circle.fill")
            .font(DLTypography.bodyMedium)
            .foregroundColor(.secondary)
            .symbolRenderingMode(.multicolor)
    }

    private func exportData() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "daylens-export-\(Date().dateKey).json"
        panel.allowedContentTypes = [.json]
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            Task { await exportToURL(url) }
        }
    }

    @MainActor
    private func exportToURL(_ url: URL) async {
        do {
            let events = try env.activityRepo.recentEvents(limit: 100_000)
            let data = try JSONEncoder().encode(events)
            try data.write(to: url)
        } catch {
            print("[Export] Error: \(error)")
        }
    }
}

// MARK: - Extension settings

struct ExtensionSettingsView: View {
    @Environment(\.appEnvironment) private var env

    var body: some View {
        Form {
            Section("Browser Extensions") {
                Text("Install the DayLens browser extension to get high-confidence website tracking (page titles, exact domains, visit duration).")
                    .font(DLTypography.bodyMedium)
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                ExtensionStatusRow(
                    browser: "Chromium (Chrome, Arc, Brave, Edge)",
                    icon: "globe",
                    isActive: env.settings.chromiumExtensionActive,
                    installNote: "Load the Extensions/Chromium folder as an unpacked extension."
                )

                ExtensionStatusRow(
                    browser: "Safari",
                    icon: "safari",
                    isActive: env.settings.safariExtensionActive,
                    installNote: "Enable in Safari → Settings → Extensions."
                )
            }

            Section("Without Extensions") {
                Text("DayLens falls back to reading window titles via Accessibility API, providing ≈50% confidence website attribution. This is sufficient for most common sites.")
                    .font(DLTypography.bodyMedium)
                    .foregroundColor(.secondary)
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}

struct ExtensionStatusRow: View {
    let browser: String
    let icon: String
    let isActive: Bool
    let installNote: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(.secondary)
                Text(browser)
                    .font(DLTypography.bodyMedium)
                Spacer()
                if isActive {
                    Label("Connected", systemImage: "checkmark.circle.fill")
                        .font(DLTypography.caption)
                        .foregroundColor(Color.dlFocusGreen)
                } else {
                    Text("Not detected")
                        .font(DLTypography.caption)
                        .foregroundColor(.secondary)
                }
            }
            if !isActive {
                Text(installNote)
                    .font(DLTypography.caption)
                    .foregroundColor(.secondary)
            }
        }
    }
}
