import SwiftUI

struct BrowserDetailView: View {
    let browser: BrowserUsageSummary

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            HStack(spacing: DS.space12) {
                AppIconView(bundleID: browser.browserBundleID, size: 48)
                VStack(alignment: .leading) {
                    Text(browser.browserName)
                        .font(.title3.weight(.semibold))
                    Text(browser.formattedDuration)
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            if !browser.topDomains.isEmpty {
                Text("Top Domains")
                    .font(.headline)

                ForEach(browser.topDomains, id: \.self) { domain in
                    Text(domain)
                        .font(.body)
                }
            }
        }
        .padding(DS.space16)
    }
}
