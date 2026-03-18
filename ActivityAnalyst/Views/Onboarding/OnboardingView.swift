import SwiftUI

/// First-launch onboarding flow.
/// Explains what the app does, requests permissions, and builds trust.
struct OnboardingView: View {
    @EnvironmentObject var appState: AppState
    @State private var currentStep: OnboardingStep = .welcome
    @StateObject private var permManager = ServiceContainer.shared.permissionManager

    enum OnboardingStep: Int, CaseIterable {
        case welcome
        case accessibility
        case browserExtensions
        case privacy
        case ready
    }

    var body: some View {
        ZStack {
            Theme.Colors.background
                .ignoresSafeArea()

            VStack(spacing: Theme.spacing32) {
                Spacer()

                stepContent

                Spacer()

                navigationButtons

                stepIndicator
            }
            .padding(Theme.spacing48)
            .frame(maxWidth: 600)
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch currentStep {
        case .welcome:
            welcomeStep
        case .accessibility:
            accessibilityStep
        case .browserExtensions:
            browserExtensionStep
        case .privacy:
            privacyStep
        case .ready:
            readyStep
        }
    }

    // MARK: - Steps

    private var welcomeStep: some View {
        VStack(spacing: Theme.spacing24) {
            Image(systemName: "chart.bar.fill")
                .font(.system(size: 56, weight: .light))
                .foregroundStyle(Theme.Colors.accent)

            VStack(spacing: Theme.spacing8) {
                Text("Welcome to Daylens")
                    .font(Theme.Typography.largeTitle)
                    .foregroundStyle(Theme.Colors.primaryText)

                Text("Understand where your time goes. Get beautiful daily insights powered by AI — all with your privacy as the default.")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 400)
            }
        }
    }

    private var accessibilityStep: some View {
        VStack(spacing: Theme.spacing24) {
            Image(systemName: "hand.raised.fill")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(Theme.Colors.accent)

            VStack(spacing: Theme.spacing8) {
                Text("Accessibility Permission")
                    .font(Theme.Typography.title)
                    .foregroundStyle(Theme.Colors.primaryText)

                Text("We need Accessibility access to detect which window is currently active. This enables accurate app and browser usage tracking.")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 400)
            }

            if permManager.accessibilityStatus == .granted {
                Label("Accessibility access granted", systemImage: "checkmark.circle.fill")
                    .font(Theme.Typography.headline)
                    .foregroundStyle(.green)
            } else {
                Button("Open System Preferences") {
                    permManager.requestAccessibility()
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.Colors.accent)

                Text("After enabling, return here. The app will detect the change automatically.")
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Colors.tertiaryText)
                    .multilineTextAlignment(.center)
            }

            Text("We never log keystrokes or record your screen.")
                .font(Theme.Typography.footnote)
                .foregroundStyle(Theme.Colors.tertiaryText)
        }
        .onAppear {
            permManager.startPolling()
        }
        .onDisappear {
            permManager.stopPolling()
        }
    }

    private var browserExtensionStep: some View {
        VStack(spacing: Theme.spacing24) {
            Image(systemName: "globe")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(Theme.Colors.accent)

            VStack(spacing: Theme.spacing8) {
                Text("Browser Extensions")
                    .font(Theme.Typography.title)
                    .foregroundStyle(Theme.Colors.primaryText)

                Text("Install our browser extension for high-accuracy website tracking. Without it, we'll use window titles as a fallback — the app works either way.")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 400)
            }

            VStack(spacing: Theme.spacing8) {
                extensionRow(
                    browser: "Chrome / Arc / Brave",
                    icon: "globe",
                    action: {
                        openChromeExtensionInstall()
                    }
                )
                extensionRow(
                    browser: "Safari",
                    icon: "safari",
                    action: {
                        openSafariExtensionSettings()
                    }
                )
            }

            Text("You can set this up later in Settings.")
                .font(Theme.Typography.footnote)
                .foregroundStyle(Theme.Colors.tertiaryText)
        }
    }

    private var privacyStep: some View {
        VStack(spacing: Theme.spacing24) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(Theme.Colors.accent)

            VStack(spacing: Theme.spacing8) {
                Text("Your Privacy Matters")
                    .font(Theme.Typography.title)
                    .foregroundStyle(Theme.Colors.primaryText)

                Text("Here's what we promise:")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.secondaryText)
            }

            VStack(alignment: .leading, spacing: Theme.spacing12) {
                privacyPoint(icon: "internaldrive", text: "All data stays on your Mac")
                privacyPoint(icon: "keyboard", text: "We never log keystrokes")
                privacyPoint(icon: "camera.fill", text: "We never record your screen")
                privacyPoint(icon: "eye.slash", text: "Private browsing is excluded by default")
                privacyPoint(icon: "trash", text: "You can export or delete all data anytime")
            }
            .frame(maxWidth: 350)
        }
    }

    private var readyStep: some View {
        VStack(spacing: Theme.spacing24) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56, weight: .light))
                .foregroundStyle(.green)

            VStack(spacing: Theme.spacing8) {
                Text("You're All Set")
                    .font(Theme.Typography.largeTitle)
                    .foregroundStyle(Theme.Colors.primaryText)

                Text("Daylens is ready to start tracking. Your dashboard will fill up as you use your Mac throughout the day.")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 400)
            }

            if permManager.accessibilityStatus != .granted {
                Label("Accessibility not granted — tracking will be limited", systemImage: "exclamationmark.triangle.fill")
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(.orange)
            }
        }
    }

    // MARK: - Navigation

    private var navigationButtons: some View {
        HStack {
            if currentStep != .welcome {
                Button("Back") {
                    withAnimation(Theme.animationMedium) {
                        if let currentIndex = OnboardingStep.allCases.firstIndex(of: currentStep),
                           currentIndex > 0 {
                            currentStep = OnboardingStep.allCases[currentIndex - 1]
                        }
                    }
                }
                .buttonStyle(.borderless)
            }

            Spacer()

            if currentStep == .ready {
                Button("Start Tracking") {
                    appState.completeOnboarding()
                    appState.startTracking()
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.Colors.accent)
            } else {
                Button("Continue") {
                    withAnimation(Theme.animationMedium) {
                        if let currentIndex = OnboardingStep.allCases.firstIndex(of: currentStep),
                           currentIndex < OnboardingStep.allCases.count - 1 {
                            currentStep = OnboardingStep.allCases[currentIndex + 1]
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.Colors.accent)
            }
        }
    }

    private var stepIndicator: some View {
        HStack(spacing: Theme.spacing8) {
            ForEach(OnboardingStep.allCases, id: \.rawValue) { step in
                Circle()
                    .fill(step == currentStep ? Theme.Colors.accent : Theme.Colors.separator)
                    .frame(width: 6, height: 6)
            }
        }
    }

    // MARK: - Helpers

    private func extensionRow(browser: String, icon: String, action: @escaping () -> Void) -> some View {
        HStack {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(Theme.Colors.secondaryText)
                .frame(width: 24)

            Text(browser)
                .font(Theme.Typography.body)

            Spacer()

            Button("Install") {
                action()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(Theme.spacing8)
        .background(Theme.Colors.groupedBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusSmall))
    }

    private func privacyPoint(icon: String, text: String) -> some View {
        HStack(spacing: Theme.spacing12) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(Theme.Colors.accent)
                .frame(width: 20)

            Text(text)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.primaryText)
        }
    }

    private func openChromeExtensionInstall() {
        #if canImport(AppKit)
        let extensionDir = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .appendingPathComponent("Extensions")
            .appendingPathComponent("Chrome")

        if FileManager.default.fileExists(atPath: extensionDir.path) {
            NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: extensionDir.path)
        } else {
            if let url = URL(string: "chrome://extensions/") {
                NSWorkspace.shared.open(url)
            }
        }
        #endif
    }

    private func openSafariExtensionSettings() {
        #if canImport(AppKit)
        if let url = URL(string: "x-apple.systempreferences:com.apple.Safari.Extensions") {
            NSWorkspace.shared.open(url)
        }
        #endif
    }
}
