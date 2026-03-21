import Foundation

enum SyncConfiguration {
    private static let defaultConvexSiteUrl = "https://decisive-aardvark-847.convex.site"
    private static let defaultWebDashboardUrl = "https://daylens-web.vercel.app"

    static var convexSiteUrl: String {
        configuredUrl(forInfoDictionaryKey: "DaylensConvexSiteURL") ?? defaultConvexSiteUrl
    }

    static var webDashboardUrl: String {
        configuredUrl(forInfoDictionaryKey: "DaylensWebDashboardURL") ?? defaultWebDashboardUrl
    }

    private static func configuredUrl(forInfoDictionaryKey key: String) -> String? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: key) as? String else {
            return nil
        }

        let trimmedValue = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedValue.isEmpty || trimmedValue.hasPrefix("$(") {
            return nil
        }

        return trimmedValue
    }
}
