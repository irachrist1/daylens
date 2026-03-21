import SwiftUI
import AppKit

struct PermissionStep: View {
    let viewModel: OnboardingViewModel

    @State private var hasRequestedPermission = false

    private var pm: PermissionManager? { viewModel.permissionManager }
    private var isGranted: Bool { pm?.isAccessibilityGranted ?? false }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: DS.space24) {
                Text("One thing before we start")
                    .font(.largeTitle.weight(.semibold))

                VStack(spacing: DS.space12) {
                    Text("Daylens watches which app is in front of your screen — that's how it knows what you're working on.")
                        .font(.body)
                        .foregroundStyle(.secondary)

                    Text("To do this, it needs Accessibility permission. This lets Daylens read the name of the active window. Nothing else.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .frame(maxWidth: 400)
            }

            Spacer()
                .frame(height: DS.space32)

            permissionCard

            Spacer()

            HStack {
                Button("Back") {
                    viewModel.goBack()
                }
                .buttonStyle(.bordered)

                Spacer()

                Button("Continue") {
                    viewModel.advance()
                }
                .buttonStyle(.borderedProminent)
                .disabled(!isGranted)
            }
            .controlSize(.large)
            .padding(.bottom, DS.space32)
        }
        .padding(.horizontal, DS.space40)
        .onAppear {
            pm?.refreshPermissions()
            // Start polling so we catch the grant even if notifications miss it
            if !isGranted {
                pm?.startPolling()
            }
        }
        .onDisappear {
            pm?.stopPolling()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            pm?.refreshPermissions()
        }
    }

    // MARK: - Permission Card

    private var permissionCard: some View {
        HStack(spacing: DS.space12) {
            Image(systemName: "hand.raised")
                .font(.title3)
                .foregroundStyle(isGranted ? .green : .secondary)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: DS.space2) {
                Text("Accessibility")
                    .font(.body.weight(.medium))
                Text("Required to read the active window")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            statusView
        }
        .padding(DS.space16)
        .background(DS.surfaceHigh, in: RoundedRectangle(cornerRadius: DS.radiusMedium))
    }

    @ViewBuilder
    private var statusView: some View {
        if isGranted {
            Label("Granted", systemImage: "checkmark.circle.fill")
                .font(.caption.weight(.medium))
                .foregroundStyle(.green)
        } else if hasRequestedPermission {
            VStack(alignment: .trailing, spacing: DS.space4) {
                Text("Waiting for permission…")
                    .font(.caption)
                    .foregroundStyle(.tertiary)

                Button("Check again") {
                    pm?.refreshPermissions()
                }
                .buttonStyle(.borderless)
                .font(.caption)
            }
        } else {
            Button("Grant Permission") {
                hasRequestedPermission = true
                pm?.requestAccessibility()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }
}
