import SwiftUI

struct WelcomeStep: View {
    let viewModel: OnboardingViewModel

    var body: some View {
        VStack(spacing: DS.space24) {
            Spacer()

            Image(systemName: "sun.max.fill")
                .font(.system(size: 56))
                .foregroundStyle(.tint)

            VStack(spacing: DS.space8) {
                Text("Welcome to Daylens")
                    .font(.largeTitle.weight(.bold))

                Text("Understand where your time goes.\nBeautiful, private, and intelligent.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            VStack(alignment: .leading, spacing: DS.space12) {
                featureRow(icon: "clock.fill", title: "Automatic Tracking", description: "Passively tracks which apps and websites you use")
                featureRow(icon: "lock.shield.fill", title: "Private by Default", description: "All data stays on your Mac — nothing leaves without your permission")
                featureRow(icon: "sparkles", title: "AI-Powered Insights", description: "Ask questions about your day in plain language")
            }
            .padding(.horizontal, DS.space32)

            Spacer()

            Button("Get Started") {
                viewModel.nextStep()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.bottom, DS.space32)
        }
        .padding(DS.space24)
    }

    private func featureRow(icon: String, title: String, description: String) -> some View {
        HStack(spacing: DS.space12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: DS.space2) {
                Text(title)
                    .font(.body.weight(.medium))
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
