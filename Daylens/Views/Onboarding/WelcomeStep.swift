import SwiftUI

struct WelcomeStep: View {
    @Bindable var viewModel: OnboardingViewModel
    @FocusState private var nameFieldFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: DS.space24) {
                Text("Welcome to Daylens")
                    .font(.largeTitle.weight(.semibold))

                Text("A quiet companion that helps you\nunderstand where your time goes.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
            }

            Spacer()
                .frame(height: DS.space40)

            VStack(alignment: .leading, spacing: DS.space8) {
                Text("What should we call you?")
                    .font(.body)
                    .foregroundStyle(.secondary)

                TextField("First name", text: $viewModel.firstName)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 240)
                    .focused($nameFieldFocused)
                    .onSubmit {
                        if viewModel.canContinueFromWelcome {
                            viewModel.advance()
                        }
                    }
            }

            Spacer()

            Button("Continue") {
                viewModel.advance()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!viewModel.canContinueFromWelcome)
            .padding(.bottom, DS.space32)
        }
        .padding(.horizontal, DS.space40)
        .onAppear { nameFieldFocused = true }
    }
}
