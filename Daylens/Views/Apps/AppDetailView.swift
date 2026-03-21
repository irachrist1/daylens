import SwiftUI

struct AppDetailView: View {
    let app: AppUsageSummary
    let date: Date
    let sessions: [AppSession]
    let websites: [WebsiteUsageSummary]
    let isLoading: Bool
    var setCategory: ((AppCategory?) -> Void)? = nil

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space24) {
                appHeader
                statsRow

                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    recentSessionsCard

                    if !websites.isEmpty {
                        topWebsitesCard
                    }
                }
            }
            .frame(maxWidth: 840, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(DS.space24)
        }
        .background(DS.surfaceContainer)
    }

    private var appHeader: some View {
        HStack(spacing: DS.space16) {
            AppRealIcon(bundleID: app.bundleID, name: app.appName, category: app.category, size: 52)

            VStack(alignment: .leading, spacing: DS.space6) {
                Text(app.appName)
                    .font(.system(.title2, weight: .bold))
                    .foregroundStyle(DS.onSurface)

                HStack(spacing: DS.space8) {
                    if let setCategory {
                        Menu {
                            ForEach(AppCategory.allCases, id: \.self) { cat in
                                Button {
                                    setCategory(cat)
                                } label: {
                                    Label(cat.rawValue, systemImage: cat.icon)
                                }
                            }
                            Divider()
                            Button("Reset to Auto-detect") { setCategory(nil) }
                        } label: {
                            HStack(spacing: 4) {
                                CategoryBadge(category: app.category)
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 7, weight: .semibold))
                                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
                            }
                        }
                        .menuStyle(.borderlessButton)
                        .fixedSize()
                    } else {
                        CategoryBadge(category: app.category)
                    }

                    Text(Self.dateFormatter.string(from: date).uppercased())
                        .font(.system(size: 9, weight: .semibold))
                        .tracking(0.8)
                        .foregroundStyle(DS.onSurfaceVariant)
                }
            }

            Spacer()
        }
    }

    private var statsRow: some View {
        HStack(spacing: DS.space12) {
            StatCard(title: "Total Time", value: app.formattedDuration, icon: "clock.fill", color: DS.primary)
            StatCard(title: "Sessions", value: "\(app.sessionCount)", icon: "repeat", color: DS.tertiary)
            StatCard(title: "Avg Session", value: averageSessionText, icon: "timer", color: DS.secondary)
            StatCard(title: "Longest", value: longestSessionText, icon: "bolt.fill", color: DS.tertiary)
        }
    }

    private var recentSessionsCard: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Recent Sessions")
                .sectionHeader()

            if sessions.isEmpty {
                Text("No detailed sessions available for this app on the selected day.")
                    .font(.body)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
            } else {
                ForEach(sessions.prefix(10)) { session in
                    HStack(spacing: DS.space12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(sessionTimeRange(session))
                                .font(.system(size: 13, weight: .medium).monospacedDigit())
                                .foregroundStyle(DS.onSurface)

                            Text(session.category.rawValue)
                                .font(.caption)
                                .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
                        }

                        Spacer()

                        Text(format(seconds: session.duration))
                            .font(.system(size: 13, weight: .semibold).monospacedDigit())
                            .foregroundStyle(DS.onSurfaceVariant)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .cardStyle()
    }

    private var topWebsitesCard: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack {
                Text("Top Websites")
                    .sectionHeader()

                Spacer()

                Text(websites.first?.confidence == .high ? "Active tab evidence" : "Estimated from browser evidence")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.65))
            }

            let maxDuration = websites.first?.totalDuration ?? 1
            ForEach(websites.prefix(8)) { site in
                UsageBar(
                    label: site.domain,
                    duration: site.totalDuration,
                    maxDuration: maxDuration,
                    color: DS.primary,
                    subtitle: site.topPageTitle
                )
            }
        }
        .cardStyle()
    }

    private var averageSessionText: String {
        guard app.sessionCount > 0 else { return "—" }
        return format(seconds: app.totalDuration / Double(app.sessionCount))
    }

    private var longestSessionText: String {
        guard let longest = sessions.map(\.duration).max() else { return "—" }
        return format(seconds: longest)
    }

    private func sessionTimeRange(_ session: AppSession) -> String {
        "\(Self.timeFormatter.string(from: session.startTime)) - \(Self.timeFormatter.string(from: session.endTime))"
    }

    private func format(seconds: TimeInterval) -> String {
        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60

        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        if minutes > 0 {
            return "\(minutes)m"
        }
        return "\(Int(seconds))s"
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter
    }()

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return formatter
    }()
}
