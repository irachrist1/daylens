import SwiftUI
import UserNotifications

// MARK: - NotificationPermissionStep

/// Standalone onboarding step for notification permissions.
/// Wire into OnboardingFlow manually.
struct NotificationPermissionStep: View {
    var onContinue: () -> Void
    var onSkip: () -> Void

    @State private var isRequesting = false
    @State private var didRequest = false

    private let bullets: [(icon: String, text: String)] = [
        ("timer", "Focus nudge when you've been switching apps for 20+ minutes"),
        ("cup.and.saucer", "Break reminder when a focus session ends"),
        ("sun.horizon", "Daily digest at 6pm with your day summary"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: DS.space24) {
                // Icon
                ZStack {
                    Circle()
                        .fill(DS.primaryContainer.opacity(0.4))
                        .frame(width: 72, height: 72)
                    Image(systemName: "bell.badge")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(DS.primary)
                }

                // Title + body
                VStack(spacing: DS.space12) {
                    Text("Stay in the zone")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(DS.onSurface)
                    Text("Daylens can nudge you when you're context-switching too much and remind you to take breaks.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                        .frame(maxWidth: 380)
                }

                // Bullet points
                VStack(alignment: .leading, spacing: DS.space12) {
                    ForEach(bullets, id: \.text) { bullet in
                        HStack(alignment: .top, spacing: DS.space12) {
                            Image(systemName: bullet.icon)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(DS.primary)
                                .frame(width: 20)
                                .padding(.top, 1)
                            Text(bullet.text)
                                .font(.callout)
                                .foregroundStyle(DS.onSurface)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(DS.space16)
                .background(DS.surfaceHighest, in: RoundedRectangle(cornerRadius: DS.radiusLarge))
                .frame(maxWidth: 380)
            }

            Spacer()
                .frame(height: DS.space40)

            VStack(spacing: DS.space12) {
                Button {
                    requestPermission()
                } label: {
                    HStack(spacing: DS.space8) {
                        if isRequesting {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(didRequest ? "Notifications Enabled" : "Enable Notifications")
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(isRequesting || didRequest)

                Button("Skip for now", action: onSkip)
                    .buttonStyle(.borderless)
                    .font(.callout)
                    .foregroundStyle(DS.onSurfaceVariant)
            }
            .padding(.bottom, DS.space32)
        }
        .padding(.horizontal, DS.space40)
    }

    private func requestPermission() {
        isRequesting = true
        Task {
            let granted = await NotificationService.shared.requestPermission()
            await MainActor.run {
                isRequesting = false
                didRequest = true
                if granted {
                    // Brief delay so user sees the "Enabled" state before advancing
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                        onContinue()
                    }
                }
            }
        }
    }
}
