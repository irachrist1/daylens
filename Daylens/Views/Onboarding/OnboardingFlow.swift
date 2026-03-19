import SwiftUI

/// Multi-step onboarding flow.
struct OnboardingFlow: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = OnboardingViewModel()

    var body: some View {
        VStack(spacing: 0) {
            // Progress indicator
            ProgressView(value: viewModel.currentStep.progress)
                .tint(.accentColor)
                .padding(.horizontal, DS.space32)
                .padding(.top, DS.space20)

            // Step content
            Group {
                switch viewModel.currentStep {
                case .welcome:
                    WelcomeStep(viewModel: viewModel)
                case .permissions:
                    PermissionsStep(viewModel: viewModel)
                case .browserAccess:
                    BrowserAccessStep(viewModel: viewModel)
                case .completion:
                    CompletionStep {
                        completeOnboarding()
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.easeInOut(duration: 0.3), value: viewModel.currentStep)
        }
        .frame(width: 560, height: 480)
        .onAppear {
            viewModel.permissionManager = appState.permissionManager
        }
    }

    private func completeOnboarding() {
        appState.hasCompletedOnboarding = true
        appState.trackingCoordinator.startTracking()
    }
}
