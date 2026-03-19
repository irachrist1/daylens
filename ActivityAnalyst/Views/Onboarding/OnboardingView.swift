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
        case browserAccess
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
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
                    .id(currentStep)

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
        case .browserAccess:
            browserAccessStep
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

            PermissionRow(
                title: "Accessibility",
                icon: "hand.raised.fill",
                status: permManager.accessibilityStatus,
                action: { permManager.requestAccessibility() }
            )
            .frame(maxWidth: 400)

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

    private var browserAccessStep: some View {
        VStack(spacing: Theme.spacing24) {
            Image(systemName: "globe")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(Theme.Colors.accent)

            VStack(spacing: Theme.spacing8) {
                Text("Browser Access")
                    .font(Theme.Typography.title)
                    .foregroundStyle(Theme.Colors.primaryText)

                Text("Grant access to your browsers so Daylens can track which websites you visit. macOS will ask you to confirm for each browser.")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 400)
            }

            #if canImport(AppKit)
            let browsers = permManager.installedBrowsers()

            if browsers.isEmpty {
                Text("No supported browsers detected.")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            } else {
                VStack(spacing: Theme.spacing8) {
                    ForEach(browsers, id: \.bundleId) { browser in
                        BrowserAccessRow(
                            name: browser.name,
                            bundleId: browser.bundleId,
                            status: permManager.automationStatuses[browser.bundleId] ?? .notDetermined,
                            action: {
                                permManager.requestAutomationAccess(for: browser.bundleId)
                            }
                        )
                    }
                }
                .frame(maxWidth: 400)
            }
            #endif

            Text("You can manage browser access later in Settings.")
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
}

// MARK: - Reusable Permission Row

struct PermissionRow: View {
    let title: String
    let icon: String
    let status: PermissionStatus
    let action: () -> Void

    var body: some View {
        HStack(spacing: Theme.spacing12) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(status == .granted ? .green : Theme.Colors.accent)
                .frame(width: 28)

            Text(title)
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.primaryText)

            Spacer()

            if status == .granted {
                HStack(spacing: Theme.spacing4) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Granted")
                        .font(Theme.Typography.callout)
                        .foregroundStyle(.green)
                }
                .transition(.scale.combined(with: .opacity))
            } else {
                Button("Grant Access") {
                    action()
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.Colors.accent)
                .controlSize(.small)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(Theme.spacing12)
        .background(
            RoundedRectangle(cornerRadius: Theme.radiusMedium)
                .fill(status == .granted
                      ? Color.green.opacity(0.06)
                      : Theme.Colors.groupedBackground)
        )
        .animation(.spring(duration: 0.35), value: status)
    }
}

// MARK: - Browser Access Row

struct BrowserAccessRow: View {
    let name: String
    let bundleId: String
    let status: PermissionStatus
    let action: () -> Void

    private var browserIcon: String {
        switch bundleId {
        case "com.apple.Safari": return "safari"
        case "org.mozilla.firefox": return "flame"
        default: return "globe"
        }
    }

    var body: some View {
        HStack(spacing: Theme.spacing12) {
            Image(systemName: browserIcon)
                .font(.system(size: 18))
                .foregroundStyle(status == .granted ? .green : Theme.Colors.secondaryText)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)

                if bundleId == "org.mozilla.firefox" {
                    Text("Requires browser extension")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.tertiaryText)
                }
            }

            Spacer()

            if status == .granted {
                HStack(spacing: Theme.spacing4) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Granted")
                        .font(Theme.Typography.callout)
                        .foregroundStyle(.green)
                }
                .transition(.scale.combined(with: .opacity))
            } else if bundleId == "org.mozilla.firefox" {
                Text("N/A")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            } else {
                Button("Grant Access") {
                    action()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(Theme.spacing12)
        .background(
            RoundedRectangle(cornerRadius: Theme.radiusMedium)
                .fill(status == .granted
                      ? Color.green.opacity(0.06)
                      : Theme.Colors.groupedBackground)
        )
        .animation(.spring(duration: 0.35), value: status)
    }
}
