import SwiftUI

/// Card displaying the AI-generated daily summary with evidence.
struct AISummaryCard: View {
    let summary: String?
    let insights: [Insight]
    var onGenerateTapped: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            HStack {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.Colors.accent)

                Text("AI Analysis")
                    .font(Theme.Typography.title3)
                    .foregroundStyle(Theme.Colors.primaryText)

                Spacer()

                if summary == nil {
                    Button(action: { onGenerateTapped?() }) {
                        Label("Generate", systemImage: "sparkles")
                            .font(Theme.Typography.callout)
                    }
                    .buttonStyle(.borderless)
                }
            }

            if let summary = summary {
                Text(summary)
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.primaryText)
                    .lineSpacing(4)
            } else {
                Text("Tap Generate to create an AI summary of today's activity.")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            }

            if !insights.isEmpty {
                Divider()

                VStack(alignment: .leading, spacing: Theme.spacing8) {
                    Text("Key Insights")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.secondaryText)

                    ForEach(insights) { insight in
                        InsightRow(insight: insight)
                    }
                }
            }
        }
        .padding(Theme.spacing16)
        .background(Theme.Colors.groupedBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
    }
}

struct InsightRow: View {
    let insight: Insight

    var body: some View {
        HStack(alignment: .top, spacing: Theme.spacing8) {
            Image(systemName: insight.type.sfSymbol)
                .font(.system(size: 12))
                .foregroundStyle(Theme.Colors.accent)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: Theme.spacing2) {
                Text(insight.title)
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)

                Text(insight.body)
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Colors.secondaryText)
                    .lineLimit(3)
            }
        }
    }
}
