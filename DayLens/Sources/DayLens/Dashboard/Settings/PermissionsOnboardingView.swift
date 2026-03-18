import SwiftUI
import AppKit

struct PermissionsOnboardingView: View {
    @Environment(\.appEnvironment) private var env
    @Environment(\.dismiss) private var dismiss

    @State private var hasAccessibility = false
    @State private var step = 0

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 12) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 48, weight: .light))
                    .foregroundColor(Color.dlAccent)
                Text("A few permissions to get started")
                    .font(DLTypography.headingLarge)
                    .multilineTextAlignment(.center)
                Text("DayLens needs a couple of system permissions to track your activity. All data stays on your Mac.")
                    .font(DLTypography.bodyMedium)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 400)
            }
            .padding(.top, 40)
            .padding(.horizontal, 40)
            .padding(.bottom, 32)

            // Permission rows
            VStack(spacing: 12) {
                PermissionRow(
                    icon: "eye.circle",
                    title: "Accessibility Access",
                    description: "Reads the frontmost window title to identify which website you're on — nothing else. No content, no keystrokes.",
                    isGranted: hasAccessibility,
                    onRequest: requestAccessibility
                )

                PermissionRow(
                    icon: "network",
                    title: "Local Network (localhost only)",
                    description: "The browser extensions communicate with DayLens over localhost:27182. No internet access is used.",
                    isGranted: true,  // No explicit grant needed — localhost is allowed
                    onRequest: nil
                )
            }
            .padding(.horizontal, 32)

            Spacer()

            // Continue button
            Button {
                env.settings.hasCompletedOnboarding = true
                env.saveSettings()
                dismiss()
            } label: {
                Text(hasAccessibility ? "Get Started" : "Continue Without Accessibility")
                    .font(DLTypography.headingSmall)
                    .frame(maxWidth: .infinity)
                    .padding(14)
                    .background(Color.dlAccent)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .padding(32)
        }
        .frame(width: 520, height: 480)
        .onAppear { checkPermissions() }
    }

    private func requestAccessibility() {
        // This opens System Preferences → Privacy → Accessibility
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        AXIsProcessTrustedWithOptions(options as CFDictionary)
        // Poll for grant
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            checkPermissions()
        }
    }

    private func checkPermissions() {
        hasAccessibility = AXIsProcessTrusted()
        env.settings.hasGrantedAccessibility = hasAccessibility
    }
}

struct PermissionRow: View {
    let icon: String
    let title: String
    let description: String
    let isGranted: Bool
    let onRequest: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 22))
                .foregroundColor(isGranted ? Color.dlFocusGreen : Color.dlAccent)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(title)
                        .font(DLTypography.headingSmall)
                    if isGranted {
                        Label("Granted", systemImage: "checkmark.circle.fill")
                            .font(DLTypography.caption)
                            .foregroundColor(Color.dlFocusGreen)
                            .labelStyle(.titleAndIcon)
                    }
                }
                Text(description)
                    .font(DLTypography.bodyMedium)
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if !isGranted, let onRequest {
                    Button("Grant Access") { onRequest() }
                        .buttonStyle(.borderless)
                        .font(DLTypography.bodyMedium)
                        .foregroundColor(Color.dlAccent)
                        .padding(.top, 4)
                }
            }
        }
        .padding(16)
        .background(Color(NSColor.controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
    }
}
