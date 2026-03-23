import SwiftUI

/// Privacy settings section: hidden apps/domains management and optional PIN lock.
/// Only functional when a Web Companion workspace is linked.
struct PrivacySection: View {
    @Environment(AppState.self) private var appState

    @State private var isUnlocked = false
    @State private var pinInput = ""
    @State private var pinError: String? = nil

    @State private var showSetPinSheet = false
    @State private var showChangePinSheet = false
    @State private var showRemovePinSheet = false

    private var prefs: PreferencesService? { appState.preferencesService }
    private var isPinRequired: Bool { prefs?.privacyPinHash != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Privacy")
                .sectionHeader()

            if prefs == nil {
                notLinkedCard
            } else if isPinRequired && !isUnlocked {
                pinLockCard
            } else {
                hiddenItemsCard
            }
        }
    }

    // MARK: - Not linked

    private var notLinkedCard: some View {
        HStack(spacing: DS.space12) {
            Image(systemName: "eye.slash")
                .font(.system(size: 16))
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
            VStack(alignment: .leading, spacing: DS.space2) {
                Text("Web Companion required")
                    .font(.body.weight(.medium))
                    .foregroundStyle(DS.onSurface)
                Text("Connect Web Companion to manage hidden apps and sites.")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant)
            }
        }
        .cardStyle()
    }

    // MARK: - PIN Lock

    private var pinLockCard: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack(spacing: DS.space8) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(DS.onSurfaceVariant)
                Text("Enter PIN to view hidden items")
                    .font(.body.weight(.medium))
                    .foregroundStyle(DS.onSurface)
            }

            HStack(spacing: DS.space8) {
                SecureField("PIN", text: $pinInput)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 120)
                    .onSubmit { attemptUnlock() }

                Button("Unlock") { attemptUnlock() }
                    .buttonStyle(.bordered)
            }

            if let error = pinError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red.opacity(0.8))
            }
        }
        .cardStyle()
    }

    private func attemptUnlock() {
        guard let prefs else { return }
        if prefs.verifyPin(pinInput) {
            isUnlocked = true
            pinError = nil
            pinInput = ""
        } else {
            pinError = "Incorrect PIN."
            pinInput = ""
        }
    }

    // MARK: - Hidden Items

    private var hiddenItemsCard: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            pinManagementRow

            if let prefs, !prefs.hiddenApps.isEmpty || !prefs.hiddenDomains.isEmpty {
                Divider()

                if !prefs.hiddenApps.isEmpty {
                    hiddenAppsList(prefs: prefs)
                }

                if !prefs.hiddenDomains.isEmpty {
                    hiddenDomainsList(prefs: prefs)
                }
            } else {
                Text("No hidden apps or sites.")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
            }
        }
        .cardStyle()
    }

    private var pinManagementRow: some View {
        HStack {
            VStack(alignment: .leading, spacing: DS.space2) {
                Text("Privacy PIN")
                    .font(.body.weight(.medium))
                    .foregroundStyle(DS.onSurface)
                Text(isPinRequired ? "PIN is set" : "Lock this section with a PIN")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant)
            }
            Spacer()
            if isPinRequired {
                HStack(spacing: DS.space8) {
                    Button("Change") { showChangePinSheet = true }
                        .buttonStyle(.bordered)
                        .sheet(isPresented: $showChangePinSheet) {
                            ChangePinSheet(onChanged: { isUnlocked = true })
                        }

                    Button("Remove", role: .destructive) { showRemovePinSheet = true }
                        .buttonStyle(.bordered)
                        .sheet(isPresented: $showRemovePinSheet) {
                            RemovePinSheet(onRemoved: { isUnlocked = true })
                        }
                }
            } else {
                Button("Set PIN") { showSetPinSheet = true }
                    .buttonStyle(.bordered)
                    .sheet(isPresented: $showSetPinSheet) {
                        SetPinSheet()
                    }
            }
        }
    }

    private func hiddenAppsList(prefs: PreferencesService) -> some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text("HIDDEN APPS")
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(DS.onSurfaceVariant)

            ForEach(prefs.hiddenApps.sorted(), id: \.self) { appKey in
                HStack {
                    Image(systemName: "square.dashed")
                        .font(.system(size: 18))
                        .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
                        .frame(width: 24, height: 24)
                    Text(appKey)
                        .font(.body)
                        .foregroundStyle(DS.onSurface)
                        .lineLimit(1)
                    Spacer()
                    Button("Show") { prefs.showAppKey(appKey) }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }
        }
    }

    private func hiddenDomainsList(prefs: PreferencesService) -> some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text("HIDDEN SITES")
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(DS.onSurfaceVariant)

            ForEach(prefs.hiddenDomains.sorted(), id: \.self) { domain in
                HStack {
                    Image(systemName: "globe")
                        .font(.system(size: 16))
                        .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
                        .frame(width: 24, height: 24)
                    Text(domain)
                        .font(.body)
                        .foregroundStyle(DS.onSurface)
                        .lineLimit(1)
                    Spacer()
                    Button("Show") { prefs.showDomain(domain) }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }
        }
    }
}

// MARK: - PIN Sheets

private struct SetPinSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var newPin = ""
    @State private var confirmPin = ""
    @State private var error: String? = nil

    var body: some View {
        VStack(spacing: DS.space16) {
            Text("Set Privacy PIN")
                .font(.title2.weight(.semibold))
                .foregroundStyle(DS.onSurface)

            Text("Use a PIN to lock the hidden items list.")
                .font(.caption)
                .foregroundStyle(DS.onSurfaceVariant)
                .multilineTextAlignment(.center)

            VStack(alignment: .leading, spacing: DS.space8) {
                SecureField("New PIN", text: $newPin)
                    .textFieldStyle(.roundedBorder)
                SecureField("Confirm PIN", text: $confirmPin)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { save() }
            }

            if let error {
                Text(error).font(.caption).foregroundStyle(.red.opacity(0.8))
            }

            HStack(spacing: DS.space12) {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                Button("Set PIN") { save() }
                    .buttonStyle(.borderedProminent)
                    .disabled(newPin.isEmpty)
            }
        }
        .padding(DS.space24)
        .frame(minWidth: 320)
    }

    private func save() {
        guard !newPin.isEmpty else { return }
        guard newPin == confirmPin else {
            error = "PINs do not match."
            return
        }
        appState.preferencesService?.setPrivacyPin(newPin)
        dismiss()
    }
}

private struct ChangePinSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    var onChanged: () -> Void

    @State private var currentPin = ""
    @State private var newPin = ""
    @State private var confirmPin = ""
    @State private var error: String? = nil

    var body: some View {
        VStack(spacing: DS.space16) {
            Text("Change PIN")
                .font(.title2.weight(.semibold))
                .foregroundStyle(DS.onSurface)

            VStack(alignment: .leading, spacing: DS.space8) {
                SecureField("Current PIN", text: $currentPin)
                    .textFieldStyle(.roundedBorder)
                SecureField("New PIN", text: $newPin)
                    .textFieldStyle(.roundedBorder)
                SecureField("Confirm new PIN", text: $confirmPin)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { save() }
            }

            if let error {
                Text(error).font(.caption).foregroundStyle(.red.opacity(0.8))
            }

            HStack(spacing: DS.space12) {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                Button("Change PIN") { save() }
                    .buttonStyle(.borderedProminent)
                    .disabled(newPin.isEmpty)
            }
        }
        .padding(DS.space24)
        .frame(minWidth: 320)
    }

    private func save() {
        guard let prefs = appState.preferencesService else { return }
        guard prefs.verifyPin(currentPin) else {
            error = "Current PIN is incorrect."
            currentPin = ""
            return
        }
        guard !newPin.isEmpty, newPin == confirmPin else {
            error = newPin.isEmpty ? "New PIN cannot be empty." : "New PINs do not match."
            return
        }
        prefs.setPrivacyPin(newPin)
        onChanged()
        dismiss()
    }
}

private struct RemovePinSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    var onRemoved: () -> Void

    @State private var currentPin = ""
    @State private var error: String? = nil

    var body: some View {
        VStack(spacing: DS.space16) {
            Text("Remove PIN")
                .font(.title2.weight(.semibold))
                .foregroundStyle(DS.onSurface)

            Text("Enter your current PIN to remove it.")
                .font(.caption)
                .foregroundStyle(DS.onSurfaceVariant)

            SecureField("Current PIN", text: $currentPin)
                .textFieldStyle(.roundedBorder)
                .onSubmit { remove() }

            if let error {
                Text(error).font(.caption).foregroundStyle(.red.opacity(0.8))
            }

            HStack(spacing: DS.space12) {
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                Button("Remove PIN", role: .destructive) { remove() }
                    .buttonStyle(.bordered)
            }
        }
        .padding(DS.space24)
        .frame(minWidth: 320)
    }

    private func remove() {
        guard let prefs = appState.preferencesService else { return }
        guard prefs.verifyPin(currentPin) else {
            error = "Incorrect PIN."
            currentPin = ""
            return
        }
        prefs.clearPrivacyPin()
        onRemoved()
        dismiss()
    }
}
