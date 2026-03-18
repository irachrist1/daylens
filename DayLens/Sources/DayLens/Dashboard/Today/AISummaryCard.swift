import SwiftUI

struct AISummaryCard: View {
    let narrative: String
    let model: String?

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(Color.dlAccent)
                Text("Today's Summary")
                    .font(DLTypography.headingSmall)
                Spacer()
                if let model {
                    Text(aiModelBadge(model))
                        .font(DLTypography.caption)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.1), in: Capsule())
                }
            }

            // Narrative text
            Text(narrative)
                .font(DLTypography.bodyMedium)
                .foregroundColor(.primary)
                .lineLimit(isExpanded ? nil : 4)
                .animation(.easeInOut(duration: 0.2), value: isExpanded)

            if narrative.count > 200 {
                Button(isExpanded ? "Show less" : "Read more") {
                    withAnimation { isExpanded.toggle() }
                }
                .font(DLTypography.caption)
                .foregroundColor(Color.dlAccent)
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(Color.dlAccent.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.dlAccent.opacity(0.15), lineWidth: 1)
        )
    }

    private func aiModelBadge(_ model: String) -> String {
        if model.contains("opus") { return "Opus" }
        if model.contains("sonnet") { return "Sonnet" }
        if model.contains("haiku") { return "Haiku" }
        return "AI"
    }
}
