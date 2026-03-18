import SwiftUI

struct PermissionsStep: View {
    let viewModel: OnboardingViewModel

    @State private var refreshID = UUID()

    private var pm: PermissionManager? { viewModel.permissionManager }

    var body: some View {
        VStack(spacing: DS.space24) {
            Spacer()

            VStack(spacing: DS.space8) {
                Text("Permissions")
                    .font(.title.weight(.bold))
                Text("Daylens needs a few permissions to track your activity accurately.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: DS.space16) {
                permissionRow(
                    icon: "hand.raised.fill",
                    title: "Accessibility",
                    description: "Read window titles for accurate app and browser tracking",
                    isGranted: pm?.isAccessibilityGranted ?? false,
                    action: { pm?.requestAccessibility() }
                )

                permissionRow(
                    icon: "internaldrive.fill",
                    title: "Full Disk Access",
                    description: "Read Safari browser history (optional — other browsers work without this)",
                    isGranted: pm?.isFullDiskAccessGranted ?? false,
                    action: { pm?.openFullDiskAccessPreferences() },
                    isOptional: true
                )

                permissionRow(
                    icon: "arrow.clockwise",
                    title: "Open at Login",
                    description: "Start tracking automatically when you log in",
                    isGranted: pm?.isLoginItemEnabled ?? false,
                    action: { pm?.enableLoginItem() }
                )
            }
            .padding(.horizontal, DS.space24)

            Spacer()

            HStack {
                Button("Back") { viewModel.previousStep() }
                    .buttonStyle(.bordered)

                Spacer()

                Button("Refresh") {
                    pm?.refreshPermissions()
                    refreshID = UUID()
                }
                .buttonStyle(.borderless)

                Button("Continue") { viewModel.nextStep() }
                    .buttonStyle(.borderedProminent)
            }
            .controlSize(.large)
            .padding(.horizontal, DS.space24)
            .padding(.bottom, DS.space32)
        }
        .padding(DS.space24)
        .id(refreshID)
    }

    private func permissionRow(
        icon: String,
        title: String,
        description: String,
        isGranted: Bool,
        action: @escaping () -> Void,
        isOptional: Bool = false
    ) -> some View {
        HStack(spacing: DS.space12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(isGranted ? .green : .secondary)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: DS.space2) {
                HStack {
                    Text(title)
                        .font(.body.weight(.medium))
                    if isOptional {
                        Text("Optional")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, DS.space4)
                            .padding(.vertical, 1)
                            .background(Color(.controlBackgroundColor), in: Capsule())
                    }
                }
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if isGranted {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            } else {
                Button("Grant") { action() }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(DS.space12)
        .background(Color(.controlBackgroundColor), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
    }
}
