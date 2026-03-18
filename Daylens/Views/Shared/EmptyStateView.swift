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
                .foregroundStyle(.tertiary)

            VStack(spacing: DS.space4) {
                Text(title)
                    .font(.title3.weight(.medium))
                    .foregroundStyle(.primary)

                Text(description)
                    .font(.body)
                    .foregroundStyle(.secondary)
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
