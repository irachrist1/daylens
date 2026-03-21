import SwiftUI

struct ReadyStep: View {
    let viewModel: OnboardingViewModel
    let onComplete: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: DS.space24) {
                Text("You're ready, \(viewModel.trimmedName).")
                    .font(.largeTitle.weight(.semibold))

                Text("Daylens is running quietly in the background.\nJust use your Mac — your activity will start\nappearing in a few minutes.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
            }

            Spacer()

            Button("Open Daylens") {
                onComplete()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.bottom, DS.space32)
        }
        .padding(.horizontal, DS.space40)
    }
}
