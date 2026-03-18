import SwiftUI

struct AppDetailView: View {
    let app: AppUsageSummary

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            HStack(spacing: DS.space12) {
                AppIconView(bundleID: app.bundleID, size: 48)
                VStack(alignment: .leading) {
                    Text(app.appName)
                        .font(.title3.weight(.semibold))
                    Text(app.category.rawValue)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: DS.space8) {
                detailRow("Total time", value: app.formattedDuration)
                detailRow("Sessions", value: "\(app.sessionCount)")
                detailRow("Bundle ID", value: app.bundleID)
            }
        }
        .padding(DS.space16)
    }

    private func detailRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.body)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.body.monospacedDigit())
        }
    }
}
