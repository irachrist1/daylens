import Foundation

enum AppConstants {
    static let appName = "Activity Analyst"
    static let bundleIdentifier = "com.activityanalyst.app"

    static let websiteURL = URL(string: "https://activityanalyst.com")!
    static let supportEmail = "support@activityanalyst.com"

    enum UserDefaultsKeys {
        static let hasCompletedOnboarding = "hasCompletedOnboarding"
        static let trackingPreferences = "trackingPreferences"
        static let selectedAIModel = "selectedAIModel"
        static let lastDailySummaryDate = "lastDailySummaryDate"
        static let sidebarSelection = "sidebarSelection"
    }

    enum NotificationNames {
        static let trackingStateChanged = Notification.Name("trackingStateChanged")
        static let newSessionRecorded = Notification.Name("newSessionRecorded")
        static let dailySummaryGenerated = Notification.Name("dailySummaryGenerated")
        static let extensionConnected = Notification.Name("extensionConnected")
        static let apiKeyChanged = Notification.Name("apiKeyChanged")
    }
}
