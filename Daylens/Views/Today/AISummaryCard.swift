import SwiftUI

/// Card showing AI-generated or local daily summary.
struct AISummaryCard: View {
    let summary: String?
    let isLoading: Bool
    let onGenerate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack {
                Label("Daily Summary", systemImage: "sparkles")
                    .sectionHeader()

                Spacer()

                Button(action: onGenerate) {
                    Label(summary == nil ? "Generate" : "Refresh", systemImage: "arrow.clockwise")
                        .font(.caption)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(isLoading)
            }

            if isLoading {
                HStack(spacing: DS.space8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Analyzing your day...")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, DS.space8)
            } else if let summary {
                Text(summary)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
                    .lineSpacing(4)
            } else {
                Text("Click Generate to get an AI-powered summary of your day, or wait for enough activity data to accumulate.")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
        }
        .cardStyle()
    }
}
