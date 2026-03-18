import SwiftUI

/// A row displaying a single session in a timeline or list view.
struct SessionRow: View {
    let appName: String
    let category: ActivityCategory
    let startTime: Date
    let duration: TimeInterval
    let websiteDomain: String?
    let confidence: Double
    let isSignificant: Bool

    var body: some View {
        HStack(spacing: Theme.spacing12) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Theme.Colors.category(category))
                .frame(width: 3)

            VStack(alignment: .leading, spacing: Theme.spacing2) {
                HStack(spacing: Theme.spacing6) {
                    Text(appName)
                        .font(Theme.Typography.headline)
                        .foregroundStyle(Theme.Colors.primaryText)

                    if let domain = websiteDomain {
                        Text("·")
                            .foregroundStyle(Theme.Colors.tertiaryText)
                        Text(domain)
                            .font(Theme.Typography.callout)
                            .foregroundStyle(Theme.Colors.secondaryText)
                    }

                    Spacer()

                    if confidence < 0.8 {
                        ConfidenceBadge(confidence: confidence)
                    }
                }

                HStack(spacing: Theme.spacing6) {
                    Text(timeRange)
                        .font(Theme.Typography.subheadline)
                        .foregroundStyle(Theme.Colors.tertiaryText)

                    Text("·")
                        .foregroundStyle(Theme.Colors.quaternaryText)

                    Text(DurationFormatter.format(duration))
                        .font(Theme.Typography.monoSmall)
                        .foregroundStyle(Theme.Colors.secondaryText)

                    if !isSignificant {
                        Text("brief")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.tertiaryText)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Theme.Colors.separator.opacity(0.3))
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                    }
                }
            }
        }
        .padding(.vertical, Theme.spacing4)
        .opacity(isSignificant ? 1.0 : 0.6)
    }

    private var timeRange: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        let start = formatter.string(from: startTime)
        let end = formatter.string(from: startTime.addingTimeInterval(duration))
        return "\(start) – \(end)"
    }
}
