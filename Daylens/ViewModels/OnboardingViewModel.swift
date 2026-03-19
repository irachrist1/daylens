import Foundation
import Observation

@Observable
final class OnboardingViewModel {
    var currentStep: Step = .welcome
    var firstName: String = ""
    var permissionManager: PermissionManager?

    enum Step: Int {
        case welcome = 0
        case permission = 1
        case ready = 2
    }

    var canContinueFromWelcome: Bool {
        !firstName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var trimmedName: String {
        firstName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func advance() {
        guard let next = Step(rawValue: currentStep.rawValue + 1) else { return }
        currentStep = next
    }

    func goBack() {
        guard let prev = Step(rawValue: currentStep.rawValue - 1) else { return }
        currentStep = prev
    }
}
