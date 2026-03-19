import SwiftUI

struct OnboardingFlow: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = OnboardingViewModel()

    var body: some View {
        Group {
            switch viewModel.currentStep {
            case .welcome:
                WelcomeStep(viewModel: viewModel)
            case .permission:
                PermissionStep(viewModel: viewModel)
            case .ready:
                ReadyStep(viewModel: viewModel, onComplete: completeOnboarding)
            }
        }
        .frame(width: 480, height: 420)
        .onAppear {
            viewModel.permissionManager = appState.permissionManager
        }
    }

    private func completeOnboarding() {
        appState.completeOnboarding(name: viewModel.trimmedName)
        appState.trackingCoordinator.startTracking()
    }
}
