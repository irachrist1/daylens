import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins

/// "Web Companion" section for Settings — link/unlink, last sync, recovery phrase.
struct WebCompanionSection: View {
    @State private var isLinking = false
    @State private var linkResult: WorkspaceLinker.WorkspaceResult?
    @State private var showRecoveryPhrase = false
    @State private var showUnlinkConfirmation = false
    @State private var convexSiteUrl = ""
    @State private var errorMessage: String?

    private let linker = WorkspaceLinker()
    private let uploader = SyncUploader.shared

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Web Companion")
                .sectionHeader()

            VStack(alignment: .leading, spacing: DS.space12) {
                if uploader.isLinked {
                    linkedContent
                } else {
                    unlinkedContent
                }

                if let error = errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red.opacity(0.8))
                }
            }
            .cardStyle()
        }
    }

    // MARK: - Linked state

    private var linkedContent: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack {
                VStack(alignment: .leading, spacing: DS.space2) {
                    HStack(spacing: DS.space8) {
                        Circle()
                            .fill(.green)
                            .frame(width: 8, height: 8)
                        Text("Connected")
                            .font(.body.weight(.medium))
                            .foregroundStyle(DS.onSurface)
                    }
                    if let lastSync = uploader.lastSyncAt {
                        Text("Last synced \(lastSync, style: .relative) ago")
                            .font(.caption)
                            .foregroundStyle(DS.onSurfaceVariant)
                    }
                }
                Spacer()
                Button("Disconnect", role: .destructive) {
                    showUnlinkConfirmation = true
                }
                .buttonStyle(.bordered)
            }

            Button {
                createBrowserLink()
            } label: {
                if isLinking {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Label("Connect Browser", systemImage: "qrcode")
                        .font(.body.weight(.medium))
                }
            }
            .buttonStyle(.bordered)
            .disabled(isLinking)

            Button {
                showRecoveryPhrase = true
            } label: {
                Label("Show Recovery Phrase", systemImage: "key")
                    .font(.body.weight(.medium))
            }
            .buttonStyle(.bordered)
            .sheet(isPresented: $showRecoveryPhrase) {
                recoveryPhraseSheet
            }
        }
        .alert("Disconnect Web Companion?", isPresented: $showUnlinkConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Disconnect", role: .destructive) {
                disconnect()
            }
        } message: {
            Text("Your data will remain on the web but no new syncs will occur. You can reconnect later using your recovery phrase.")
        }
    }

    // MARK: - Unlinked state

    private var unlinkedContent: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack {
                VStack(alignment: .leading, spacing: DS.space2) {
                    Text("Not Connected")
                        .font(.body.weight(.medium))
                        .foregroundStyle(DS.onSurface)
                    Text("Link to view your activity on the web")
                        .font(.caption)
                        .foregroundStyle(DS.onSurfaceVariant)
                }
                Spacer()
            }

            HStack(spacing: DS.space8) {
                TextField("Convex site URL", text: $convexSiteUrl)
                    .textFieldStyle(.roundedBorder)

                Button {
                    link()
                } label: {
                    if isLinking {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text("Link")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(isLinking || convexSiteUrl.isEmpty)
            }

            if let result = linkResult {
                VStack(alignment: .leading, spacing: DS.space8) {
                    Text("Browser Link")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(DS.onSurfaceVariant)

                    QRCodeCard(token: result.linkToken)

                    Text("Reference code: \(result.linkCode)")
                        .font(.system(.body, design: .monospaced).weight(.bold))
                        .foregroundStyle(DS.primary)

                    Text("Scan the QR code in the browser. The visible code is only the first 8 characters.")
                        .font(.caption)
                        .foregroundStyle(DS.onSurfaceVariant)

                    recoveryPhraseDisplay(mnemonic: result.mnemonic)
                }
            }
        }
    }

    // MARK: - Recovery phrase

    private func recoveryPhraseDisplay(mnemonic: String) -> some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text("Recovery Phrase — save this now!")
                .font(.caption.weight(.bold))
                .foregroundStyle(.orange)

            Text(mnemonic)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(DS.onSurface)
                .textSelection(.enabled)
                .padding(DS.space8)
                .background(DS.surfaceLowest.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 8))

            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(mnemonic, forType: .string)
            } label: {
                Label("Copy to Clipboard", systemImage: "doc.on.doc")
                    .font(.caption)
            }
            .buttonStyle(.bordered)
        }
    }

    private var recoveryPhraseSheet: some View {
        VStack(spacing: DS.space16) {
            Text("Recovery Phrase")
                .font(.title2.weight(.semibold))
                .foregroundStyle(DS.onSurface)

            let keychain = KeychainService(service: "com.daylens.sync")
            if let mnemonic = keychain.string(for: "recovery-mnemonic") {
                recoveryPhraseDisplay(mnemonic: mnemonic)
            } else {
                Text("Recovery phrase not available.")
                    .foregroundStyle(DS.onSurfaceVariant)
            }

            Button("Done") {
                showRecoveryPhrase = false
            }
            .buttonStyle(.bordered)
        }
        .padding(DS.space24)
        .frame(minWidth: 400)
    }

    // MARK: - Actions

    private func link() {
        isLinking = true
        errorMessage = nil

        Task {
            do {
                let result = try await linker.createWorkspace(convexSiteUrl: convexSiteUrl)
                await MainActor.run {
                    linkResult = result
                    isLinking = false
                    SyncUploader.shared.startSync()
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLinking = false
                }
            }
        }
    }

    private func createBrowserLink() {
        isLinking = true
        errorMessage = nil

        Task {
            do {
                let result = try await linker.createBrowserLink()
                await MainActor.run {
                    if let current = linkResult {
                        linkResult = WorkspaceLinker.WorkspaceResult(
                            workspaceId: current.workspaceId,
                            mnemonic: current.mnemonic,
                            linkCode: result.displayCode,
                            linkToken: result.fullToken
                        )
                    } else {
                        let keychain = KeychainService(service: "com.daylens.sync")
                        let mnemonic = keychain.string(for: "recovery-mnemonic") ?? ""
                        linkResult = WorkspaceLinker.WorkspaceResult(
                            workspaceId: uploader.workspaceId ?? "",
                            mnemonic: mnemonic,
                            linkCode: result.displayCode,
                            linkToken: result.fullToken
                        )
                    }
                    isLinking = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLinking = false
                }
            }
        }
    }

    private func disconnect() {
        do {
            try SyncUploader.shared.clearWorkspaceCredentials()
            linkResult = nil
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct QRCodeCard: View {
    let token: String

    private let context = CIContext()
    private let filter = CIFilter.qrCodeGenerator()

    var body: some View {
        Group {
            if let image = qrImage(from: token) {
                Image(nsImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 180, height: 180)
                    .padding(DS.space8)
                    .background(DS.surfaceLowest)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(DS.surfaceLowest)
                    .frame(width: 180, height: 180)
            }
        }
    }

    private func qrImage(from string: String) -> NSImage? {
        filter.setValue(Data(string.utf8), forKey: "inputMessage")
        filter.correctionLevel = "M"

        guard let outputImage = filter.outputImage else { return nil }
        let scaled = outputImage.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return NSImage(cgImage: cgImage, size: NSSize(width: 180, height: 180))
    }
}
