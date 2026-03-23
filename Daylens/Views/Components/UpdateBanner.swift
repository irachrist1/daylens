import SwiftUI

struct UpdateBanner: View {
    @Environment(UpdateChecker.self) private var updateChecker
    @Environment(UpdateInstaller.self) private var updateInstaller

    @State private var isShowingReleaseNotes = false

    var body: some View {
        HStack(spacing: DS.space12) {
            Image(systemName: iconName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.accentColor)

            bannerBody

            Spacer(minLength: DS.space12)

            if showsReleaseNotesButton {
                Button("What's new") {
                    isShowingReleaseNotes = true
                }
                .buttonStyle(.link)
                .popover(isPresented: $isShowingReleaseNotes, arrowEdge: .top) {
                    releaseNotesPopover
                }
            }

            actionArea

            Button {
                updateChecker.dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(DS.space4)
            }
            .buttonStyle(.plain)
            .disabled(updateInstaller.isBusy)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .modifier(LiquidGlassPanel(cornerRadius: 10))
    }

    @ViewBuilder
    private var bannerBody: some View {
        switch updateInstaller.phase {
        case .downloading:
            VStack(alignment: .leading, spacing: DS.space6) {
                Text("Downloading...")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(DS.onSurface)

                ProgressView(value: updateInstaller.downloadProgress)
                    .progressViewStyle(.linear)
                    .tint(Color.accentColor)
                    .frame(width: 220)
            }
        case .installing:
            VStack(alignment: .leading, spacing: DS.space6) {
                Text("Installing update...")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(DS.onSurface)

                ProgressView(value: 1.0)
                    .progressViewStyle(.linear)
                    .tint(Color.accentColor)
                    .frame(width: 220)
            }
        case .failed(let message):
            Text(message)
                .font(.callout.weight(.medium))
                .foregroundStyle(DS.onSurface)
        case .manualInstallRequired(let message):
            Text(message)
                .font(.callout.weight(.medium))
                .foregroundStyle(DS.onSurface)
        case .idle:
            Text("Daylens \(updateChecker.latestVersion ?? "Update") is available")
                .font(.callout.weight(.medium))
                .foregroundStyle(DS.onSurface)
        }
    }

    @ViewBuilder
    private var actionArea: some View {
        switch updateInstaller.phase {
        case .downloading, .installing:
            EmptyView()
        case .failed:
            Button("Retry") {
                startInstall()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        case .manualInstallRequired:
            Button("Show in Finder") {
                updateInstaller.revealManualInstall()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        case .idle:
            Button("Update") {
                startInstall()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(updateChecker.downloadURL == nil)
        }
    }

    private var iconName: String {
        switch updateInstaller.phase {
        case .failed:
            return "exclamationmark.triangle.fill"
        case .manualInstallRequired:
            return "folder.badge.plus"
        default:
            return "arrow.down.circle.fill"
        }
    }

    private var showsReleaseNotesButton: Bool {
        guard case .idle = updateInstaller.phase else { return false }
        return !(updateChecker.releaseNotes ?? "").isEmpty
    }

    private var releaseNotesPopover: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space12) {
                Text("What's New")
                    .font(.headline)
                    .foregroundStyle(DS.onSurface)

                Text(updateChecker.releaseNotes ?? "No release notes were included with this release.")
                    .font(.callout)
                    .foregroundStyle(DS.onSurfaceVariant)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(DS.space16)
        }
        .frame(minHeight: 200, maxHeight: 420)
        .frame(width: 360)
    }

    private func startInstall() {
        guard let url = updateChecker.downloadURL else { return }
        updateInstaller.resetFailure()

        Task {
            do {
                try await updateInstaller.downloadAndInstall(from: url)
            } catch {
                // The installer publishes the banner state; no extra UI work is needed here.
            }
        }
    }
}
