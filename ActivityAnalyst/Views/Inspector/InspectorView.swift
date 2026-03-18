import SwiftUI

/// Right-side inspector panel for drill-downs, filters, and AI summaries.
struct InspectorView: View {
    let destination: SidebarDestination

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            inspectorHeader

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: Theme.spacing16) {
                    switch destination {
                    case .today:
                        todayInspector
                    case .apps:
                        appsInspector
                    case .browsers:
                        browsersInspector
                    case .websites:
                        websitesInspector
                    case .insights:
                        insightsInspector
                    default:
                        defaultInspector
                    }
                }
                .padding(Theme.spacing16)
            }
        }
        .background(.ultraThinMaterial)
    }

    private var inspectorHeader: some View {
        HStack {
            Text("Inspector")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.secondaryText)
            Spacer()
        }
        .padding(Theme.spacing12)
    }

    @EnvironmentObject var appState: AppState

    private var todayInspector: some View {
        VStack(alignment: .leading, spacing: Theme.spacing16) {
            InspectorSection(title: "Status") {
                InspectorRow(label: "Tracking", value: appState.isTracking ? "Active" : "Paused")
                InspectorRow(label: "Accessibility", value: ServiceContainer.shared.permissionManager.accessibilityStatus == .granted ? "Granted" : "Not granted")
                InspectorRow(label: "AI", value: ServiceContainer.shared.hasAI ? "Available" : "Not configured")
                InspectorRow(label: "Database", value: ServiceContainer.shared.hasStore ? "Connected" : "Error")
            }

            InspectorSection(title: "Capture Sources") {
                InspectorRow(label: "App monitor", value: "NSWorkspace")
                InspectorRow(label: "Window monitor", value: ServiceContainer.shared.permissionManager.accessibilityStatus == .granted ? "Accessibility API" : "Unavailable")
                InspectorRow(label: "Browser ext.", value: "WebSocket :19847")
            }
        }
    }

    private var appsInspector: some View {
        InspectorSection(title: "Selected App") {
            Text("Select an app to see details")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.tertiaryText)
        }
    }

    private var browsersInspector: some View {
        InspectorSection(title: "Browser Details") {
            Text("Select a browser to see details")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.tertiaryText)
        }
    }

    private var websitesInspector: some View {
        InspectorSection(title: "Website Details") {
            Text("Select a website to see details")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.tertiaryText)
        }
    }

    private var insightsInspector: some View {
        InspectorSection(title: "AI Model") {
            InspectorRow(label: "Model", value: AIModel.sonnet.displayName)
            InspectorRow(label: "Context", value: "Last 7 days")
        }
    }

    private var defaultInspector: some View {
        Text("No inspector available for this view")
            .font(Theme.Typography.callout)
            .foregroundStyle(Theme.Colors.tertiaryText)
    }
}

// MARK: - Inspector Helpers

struct InspectorSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing8) {
            Text(title)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.tertiaryText)
                .textCase(.uppercase)

            content()
        }
    }
}

struct InspectorRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.secondaryText)
            Spacer()
            Text(value)
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.primaryText)
        }
    }
}

struct FocusBar: View {
    let label: String
    let fraction: Double
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing2) {
            HStack {
                Text(label)
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Colors.secondaryText)
                Spacer()
                Text("\(Int(fraction * 100))%")
                    .font(Theme.Typography.monoSmall)
                    .foregroundStyle(Theme.Colors.tertiaryText)
            }

            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Theme.Colors.separator.opacity(0.3))

                    RoundedRectangle(cornerRadius: 2)
                        .fill(color)
                        .frame(width: geometry.size.width * CGFloat(fraction))
                }
            }
            .frame(height: 6)
        }
    }
}
