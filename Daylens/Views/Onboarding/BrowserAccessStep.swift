import SwiftUI

struct BrowserAccessStep: View {
    let viewModel: OnboardingViewModel

    var body: some View {
        VStack(spacing: DS.space24) {
            Spacer()

            VStack(spacing: DS.space8) {
                Text("Browser Tracking")
                    .font(.title.weight(.bold))
                Text("Daylens reads your browser history locally to show which websites you visit. No extensions required.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 400)
            }

            VStack(alignment: .leading, spacing: DS.space16) {
                browserRow(
                    name: "Chrome, Arc, Brave, Edge",
                    icon: "globe",
                    status: "Automatic",
                    description: "Daylens reads the local history database directly. No setup needed."
                )

                browserRow(
                    name: "Safari",
                    icon: "safari.fill",
                    status: "Requires Full Disk Access",
                    description: "Safari's history is protected. Grant Full Disk Access in the previous step to enable."
                )

                browserRow(
                    name: "Firefox",
                    icon: "globe.americas.fill",
                    status: "Automatic",
                    description: "Daylens reads the local places database. No setup needed."
                )
            }
            .padding(.horizontal, DS.space24)

            VStack(spacing: DS.space4) {
                Image(systemName: "lock.shield")
                    .foregroundStyle(.secondary)
                Text("All browser data is read locally and never leaves your Mac.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            HStack {
                Button("Back") { viewModel.previousStep() }
                    .buttonStyle(.bordered)
                Spacer()
                Button("Continue") { viewModel.nextStep() }
                    .buttonStyle(.borderedProminent)
            }
            .controlSize(.large)
            .padding(.horizontal, DS.space24)
            .padding(.bottom, DS.space32)
        }
        .padding(DS.space24)
    }

    private func browserRow(name: String, icon: String, status: String, description: String) -> some View {
        HStack(spacing: DS.space12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: DS.space2) {
                HStack {
                    Text(name)
                        .font(.body.weight(.medium))
                    Spacer()
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(DS.space12)
        .background(Color(.controlBackgroundColor), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
    }
}
