import SwiftUI

/// Reusable empty state view with icon, title, and description.
struct EmptyStateView: View {
    let icon: String
    let title: String
    let description: String
    var action: (() -> Void)?
    var actionLabel: String?

    var body: some View {
        VStack(spacing: DS.space16) {
            Image(systemName: icon)
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.35))

            VStack(spacing: DS.space4) {
                Text(title)
                    .font(.title3.weight(.medium))
                    .foregroundStyle(DS.onSurface)

                Text(description)
                    .font(.body)
                    .foregroundStyle(DS.onSurfaceVariant)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 300)
            }

            if let action, let actionLabel {
                Button(actionLabel, action: action)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DS.space32)
    }
}
