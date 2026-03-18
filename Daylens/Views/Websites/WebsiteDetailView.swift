import SwiftUI

struct WebsiteDetailView: View {
    let site: WebsiteUsageSummary

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            HStack(spacing: DS.space12) {
                Image(systemName: "globe")
                    .font(.largeTitle)
                    .foregroundStyle(.accent)

                VStack(alignment: .leading) {
                    Text(site.domain)
                        .font(.title3.weight(.semibold))
                    if let title = site.topPageTitle {
                        Text(title)
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: DS.space8) {
                detailRow("Total time", value: site.formattedDuration)
                detailRow("Visits", value: "\(site.visitCount)")
                detailRow("Browser", value: site.browserName)
                detailRow("Confidence", value: site.confidence.rawValue.capitalized)
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
                .font(.body)
        }
    }
}
