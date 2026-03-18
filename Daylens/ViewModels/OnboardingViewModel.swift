import SwiftUI
import Observation

@Observable
final class OnboardingViewModel {
    var currentStep: OnboardingStep = .welcome
    var permissionManager: PermissionManager?

    enum OnboardingStep: Int, CaseIterable {
        case welcome = 0
        case permissions = 1
        case browserAccess = 2
        case completion = 3

        var title: String {
            switch self {
            case .welcome: return "Welcome to Daylens"
            case .permissions: return "Permissions"
            case .browserAccess: return "Browser Data"
            case .completion: return "You're All Set"
            }
        }

        var progress: Double {
            Double(rawValue) / Double(OnboardingStep.allCases.count - 1)
        }
    }

    func nextStep() {
        guard let next = OnboardingStep(rawValue: currentStep.rawValue + 1) else { return }
        currentStep = next
    }

    func previousStep() {
        guard let prev = OnboardingStep(rawValue: currentStep.rawValue - 1) else { return }
        currentStep = prev
    }
}
