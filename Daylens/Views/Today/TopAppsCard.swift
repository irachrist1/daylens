import SwiftUI

/// Card showing top apps by usage time.
struct TopAppsCard: View {
    let summaries: [AppUsageSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Top Apps")
                .sectionHeader()

            if summaries.isEmpty {
                Text("No app data yet. Keep using your Mac and check back soon.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, DS.space8)
            } else {
                let maxDuration = summaries.first?.totalDuration ?? 1

                ForEach(summaries.prefix(8)) { app in
                    HStack(spacing: DS.space12) {
                        AppIconView(bundleID: app.bundleID, size: 24)

                        UsageBar(
                            label: app.appName,
                            duration: app.totalDuration,
                            maxDuration: maxDuration,
                            color: DS.categoryColor(for: app.category)
                        )
                    }
                }
            }
        }
        .cardStyle()
    }
}
