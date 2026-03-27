import UserNotifications
import Foundation

// MARK: - NotificationService

@MainActor
final class NotificationService: ObservableObject {
    static let shared = NotificationService()
    private init() {}

    // MARK: - Permission

    /// Requests notification authorization. Returns true if granted.
    func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let current = await center.notificationSettings()
        if current.authorizationStatus == .authorized { return true }

        do {
            return try await center.requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            return false
        }
    }

    // MARK: - Scheduling

    /// Schedules a one-time break reminder after the given number of seconds.
    func scheduleBreakReminder(afterSeconds: TimeInterval) {
        Task {
            guard await isAuthorized() else { return }

            let content = UNMutableNotificationContent()
            content.title = "Break time"
            content.body = "Your focus session just ended. Step away for a few minutes."
            content.sound = .default

            let trigger = UNTimeIntervalNotificationTrigger(
                timeInterval: max(afterSeconds, 1),
                repeats: false
            )
            let request = UNNotificationRequest(
                identifier: "daylens.reminder.break",
                content: content,
                trigger: trigger
            )
            try? await UNUserNotificationCenter.current().add(request)
        }
    }

    /// Schedules a daily digest notification at the specified hour and minute (24h clock).
    func scheduleDailyDigest(hour: Int = 18, minute: Int = 0) {
        Task {
            guard await isAuthorized() else { return }

            let content = UNMutableNotificationContent()
            content.title = "Your day at a glance"
            content.body = "Tap to see today's activity summary"
            content.sound = .default

            var dateComponents = DateComponents()
            dateComponents.hour = hour
            dateComponents.minute = minute

            let trigger = UNCalendarNotificationTrigger(
                dateMatching: dateComponents,
                repeats: true
            )
            let request = UNNotificationRequest(
                identifier: "daylens.notification.daily_digest",
                content: content,
                trigger: trigger
            )

            // Remove any existing daily digest before scheduling
            UNUserNotificationCenter.current()
                .removePendingNotificationRequests(withIdentifiers: ["daylens.notification.daily_digest"])
            try? await UNUserNotificationCenter.current().add(request)
        }
    }

    /// Cancels all pending Daylens notifications.
    func cancelAll() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
    }

    /// Schedules a one-off context-switch nudge 20 minutes from now.
    /// Cancels any previously scheduled nudge with the same identifier first.
    func scheduleContextSwitchNudge() {
        Task {
            guard await isAuthorized() else { return }

            let center = UNUserNotificationCenter.current()
            let id = "daylens.notification.context_switch"
            center.removePendingNotificationRequests(withIdentifiers: [id])

            let content = UNMutableNotificationContent()
            content.title = "You've been context-switching"
            content.body = "Try staying in one app for the next 30 minutes"
            content.sound = .default

            let trigger = UNTimeIntervalNotificationTrigger(
                timeInterval: 20 * 60,
                repeats: false
            )
            let request = UNNotificationRequest(
                identifier: id,
                content: content,
                trigger: trigger
            )
            try? await center.add(request)
        }
    }

    // MARK: - Private

    private func isAuthorized() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus == .authorized
    }
}
