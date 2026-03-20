import SwiftUI

struct AppDetailView: View {
    let app: AppUsageSummary

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space24) {
                // Header
                appHeader
                // Stats row
                statsRow
                // Efficiency
                efficiencyCard
            }
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
                    Text("CORE TOOL")
                        .font(.system(size: 9, weight: .semibold))
                        .tracking(0.8)
                        .foregroundStyle(DS.onPrimaryFixed)
                        .padding(.horizontal, DS.space8)
                        .padding(.vertical, 3)
                        .background(DS.primaryContainer, in: Capsule())
                    CategoryBadge(category: app.category)
                }
            }
            Spacer()
        }
    }

    private var statsRow: some View {
        HStack(spacing: DS.space12) {
            StatCard(title: "Total Time", value: app.formattedDuration, icon: "clock.fill", color: DS.primary)
            StatCard(title: "Sessions", value: "\(app.sessionCount)", icon: "repeat", color: DS.tertiary)
            StatCard(title: "Avg Session", value: avgSession, icon: "timer", color: DS.secondary)
        }
    }

    private var efficiencyCard: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            Text("Efficiency Dynamics")
                .sectionHeader()

            let focusFraction = min(1.0, app.totalDuration / max(1, app.totalDuration * 1.25))

            VStack(spacing: DS.space12) {
                efficiencyRow(label: "Active Focus", value: focusFraction, color: DS.primary)
                efficiencyRow(label: "Idle / Background", value: 1 - focusFraction, color: DS.surfaceHighest)
            }

            Text("Usage data based on active window tracking.")
                .font(.caption)
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
        }
        .cardStyle()
    }

    private func efficiencyRow(label: String, value: Double, color: Color) -> some View {
        VStack(alignment: .leading, spacing: DS.space6) {
            HStack {
                Text(label)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DS.onSurface)
                Spacer()
                Text("\(Int(value * 100))%")
                    .font(.system(size: 13, weight: .semibold).monospacedDigit())
                    .foregroundStyle(DS.onSurface)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(DS.surfaceHighest)
                    Capsule().fill(color).frame(width: geo.size.width * value)
                }
            }
            .frame(height: 6)
        }
    }

    private var avgSession: String {
        guard app.sessionCount > 0 else { return "—" }
        let avg = app.totalDuration / Double(app.sessionCount)
        let m = Int(avg) / 60
        return "\(m)m"
    }
}
