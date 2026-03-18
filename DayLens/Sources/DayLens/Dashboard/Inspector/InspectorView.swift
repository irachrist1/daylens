import SwiftUI

/// Right-panel inspector — shows drill-down detail for the currently selected item.
struct InspectorView: View {
    @Environment(\.appEnvironment) private var env

    var body: some View {
        Group {
            if let item = env.inspectorItem {
                ScrollView {
                    itemDetail(for: item)
                        .padding(20)
                }
            } else {
                placeholder
            }
        }
        .frame(minWidth: 240, idealWidth: 280)
        .background(Color(NSColor.controlBackgroundColor))
    }

    // MARK: - Placeholder

    private var placeholder: some View {
        VStack(spacing: 10) {
            Image(systemName: "sidebar.right")
                .font(.system(size: 32))
                .foregroundColor(.secondary)
            Text("Select an item to inspect")
                .font(DLTypography.bodyMedium)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Item details

    @ViewBuilder
    private func itemDetail(for item: InspectorItem) -> some View {
        switch item {
        case .app(let summary):
            AppInspectorView(summary: summary)
        case .website(let summary):
            WebsiteInspectorView(summary: summary)
        case .browser(let summary):
            BrowserInspectorView(summary: summary)
        case .session(let session):
            SessionInspectorView(session: session)
        }
    }
}

// MARK: - App inspector

struct AppInspectorView: View {
    let summary: AppUsageSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.dlAccent.opacity(0.15))
                    .frame(width: 40, height: 40)
                    .overlay(Image(systemName: "square.grid.2x2")
                        .foregroundColor(Color.dlAccent))
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary.appName).font(DLTypography.headingMedium)
                    Text(summary.appBundleId).font(DLTypography.caption).foregroundColor(.secondary)
                }
            }

            Divider()

            InspectorRow(label: "Active time", value: summary.totalSeconds.durationString)
            InspectorRow(label: "Sessions", value: "\(summary.sessionCount)")
            InspectorRow(label: "Category",
                         value: AppCategory.classify(bundleId: summary.appBundleId,
                                                     appName: summary.appName).rawValue)
            InspectorRow(label: "Date", value: summary.dateKey)
        }
    }
}

// MARK: - Website inspector

struct WebsiteInspectorView: View {
    let summary: WebsiteUsageSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.dlFocusGreen.opacity(0.15))
                    .frame(width: 40, height: 40)
                    .overlay(Image(systemName: "globe").foregroundColor(Color.dlFocusGreen))
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary.domain).font(DLTypography.headingMedium)
                    Text("Website").font(DLTypography.caption).foregroundColor(.secondary)
                }
            }

            Divider()

            InspectorRow(label: "Time spent", value: summary.totalSeconds.durationString)
            InspectorRow(label: "Visits", value: "\(summary.visitCount)")
            InspectorRow(label: "Confidence",
                         value: String(format: "%.0f%%", summary.avgConfidence * 100))
            InspectorRow(label: "Date", value: summary.dateKey)
        }
    }
}

// MARK: - Browser inspector

struct BrowserInspectorView: View {
    let summary: BrowserUsageSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.dlAccent.opacity(0.15))
                    .frame(width: 40, height: 40)
                    .overlay(Image(systemName: "safari").foregroundColor(Color.dlAccent))
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary.browserName).font(DLTypography.headingMedium)
                    Text("Browser").font(DLTypography.caption).foregroundColor(.secondary)
                }
            }

            Divider()

            InspectorRow(label: "Active time", value: summary.totalSeconds.durationString)
            InspectorRow(label: "Sessions", value: "\(summary.sessionCount)")
            InspectorRow(label: "Date", value: summary.dateKey)
        }
    }
}

// MARK: - Session inspector

struct SessionInspectorView: View {
    let session: AppSession

    private var fmt: DateFormatter {
        let f = DateFormatter(); f.dateFormat = "h:mm:ss a"; return f
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(session.appName).font(DLTypography.headingMedium)

            Divider()

            InspectorRow(label: "Started", value: fmt.string(from: session.startDate))
            if let end = session.endDate {
                InspectorRow(label: "Ended", value: fmt.string(from: end))
            }
            InspectorRow(label: "Duration", value: session.activeDuration.durationString)
            InspectorRow(label: "Bundle ID", value: session.appBundleId)
        }
    }
}

// MARK: - Shared row

struct InspectorRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(DLTypography.caption)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .font(DLTypography.bodyMedium)
                .multilineTextAlignment(.trailing)
        }
    }
}
