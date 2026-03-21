import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins

/// "Web Companion" section for Settings — link/unlink, last sync, recovery phrase.
struct WebCompanionSection: View {
    @State private var isLinking = false
    @State private var linkResult: WorkspaceLinker.WorkspaceResult?
    @State private var showRecoveryPhrase = false
    @State private var showUnlinkConfirmation = false
    @State private var errorMessage: String?

    private let linker = WorkspaceLinker()
    private let uploader = SyncUploader.shared

    private static let convexSiteUrl = SyncConfiguration.convexSiteUrl
    private static let webDashboardUrl = SyncConfiguration.webDashboardUrl

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Web Companion")
                .sectionHeader()

            VStack(alignment: .leading, spacing: DS.space12) {
                // If we just generated a link code, ALWAYS show it — even if already connected.
                // This is the critical moment where the user needs to see the QR code.
                if let result = linkResult {
                    activeLinkContent(result: result)
                } else if uploader.isLinked {
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

    // MARK: - Active link code display (shown immediately after connecting or clicking "Connect Browser")

    private func activeLinkContent(result: WorkspaceLinker.WorkspaceResult) -> some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            // Status bar
            HStack {
                HStack(spacing: DS.space8) {
                    Circle()
                        .fill(.green)
                        .frame(width: 8, height: 8)
                    Text("Connected")
                        .font(.body.weight(.medium))
                        .foregroundStyle(DS.onSurface)
                }
                Spacer()
                Button("Done") {
                    linkResult = nil
                }
                .buttonStyle(.bordered)
            }

            // Clear instruction
            VStack(alignment: .leading, spacing: DS.space4) {
                Text("Now open Daylens Web in your browser")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(DS.onSurface)
                Text("Scan the QR code below, or copy and paste the link code.")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant)
            }

            // QR code — encodes a URL, not just the raw token
            QRCodeCard(token: "\(Self.webDashboardUrl)?token=\(result.linkToken)")

            // Link code — clearly labeled and copyable
            VStack(alignment: .leading, spacing: DS.space8) {
                Text("LINK CODE")
                    .font(.system(size: 10, weight: .bold, design: .default))
                    .foregroundStyle(DS.onSurfaceVariant)
                    .tracking(1)

                HStack(spacing: DS.space8) {
                    Text(result.linkToken)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(DS.onSurface)
                        .textSelection(.enabled)
                        .lineLimit(1)

                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(result.linkToken, forType: .string)
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                }

                Text("Paste this at \(Self.webDashboardUrl)")
                    .font(.caption)
                    .foregroundStyle(DS.primary)

                Text("This code expires in 5 minutes.")
                    .font(.caption2)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
            }
            .padding(DS.space12)
            .background(DS.surfaceLowest.opacity(0.5))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            // Recovery phrase — separate section, clearly different from link code
            VStack(alignment: .leading, spacing: DS.space8) {
                Text("RECOVERY PHRASE")
                    .font(.system(size: 10, weight: .bold, design: .default))
                    .foregroundStyle(.orange)
                    .tracking(1)

                Text("Save this separately. Use it to restore your workspace if you reinstall.")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant)

                Text(result.mnemonic)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(DS.onSurface)
                    .textSelection(.enabled)
                    .padding(DS.space8)
                    .background(DS.surfaceLowest.opacity(0.3))
                    .clipShape(RoundedRectangle(cornerRadius: 6))

                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(result.mnemonic, forType: .string)
                } label: {
                    Label("Copy Recovery Phrase", systemImage: "doc.on.doc")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
            }
        }
    }

    // MARK: - Linked state (no active link code — just status and actions)

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
                    Label("Connect a Browser", systemImage: "qrcode")
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
                    Text("View your activity data from any browser")
                        .font(.caption)
                        .foregroundStyle(DS.onSurfaceVariant)
                }
                Spacer()
            }

            Button {
                link()
            } label: {
                if isLinking {
                    HStack(spacing: DS.space8) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Setting up...")
                    }
                } else {
                    Label("Connect to Web", systemImage: "link")
                        .font(.body.weight(.medium))
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isLinking)
        }
    }

    // MARK: - Recovery phrase sheet

    private var recoveryPhraseSheet: some View {
        VStack(spacing: DS.space16) {
            Text("Recovery Phrase")
                .font(.title2.weight(.semibold))
                .foregroundStyle(DS.onSurface)

            let keychain = KeychainService(service: "com.daylens.sync")
            if let mnemonic = keychain.string(for: "recovery-mnemonic") {
                VStack(alignment: .leading, spacing: DS.space8) {
                    Text("Use this to restore your workspace if you reinstall Daylens.")
                        .font(.caption)
                        .foregroundStyle(DS.onSurfaceVariant)

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
                let result = try await linker.createWorkspace(convexSiteUrl: Self.convexSiteUrl)
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
                    let keychain = KeychainService(service: "com.daylens.sync")
                    let mnemonic = keychain.string(for: "recovery-mnemonic") ?? ""
                    linkResult = WorkspaceLinker.WorkspaceResult(
                        workspaceId: uploader.workspaceId ?? "",
                        mnemonic: mnemonic,
                        linkCode: result.displayCode,
                        linkToken: result.fullToken
                    )
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
                    .background(.white)
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
