import SwiftUI

/// Right detail/inspector panel showing contextual information.
struct InspectorPanel: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space20) {
                switch appState.selectedSection {
                case .today:
                    todayInspector
                case .apps:
                    appsInspector
                default:
                    EmptyView()
                }
            }
            .padding(DS.space20)
        }
        .background(Color(.windowBackgroundColor))
    }

    // MARK: - Section-specific inspectors

    private var todayInspector: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            Text("Keyboard Shortcuts")
                .sectionHeader()

            VStack(alignment: .leading, spacing: DS.space6) {
                shortcutRow("Previous day", shortcut: "⌘ [")
                shortcutRow("Next day", shortcut: "⌘ ]")
                shortcutRow("Today", shortcut: "⌘ T")
            }
        }
    }

    private var appsInspector: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            Text("App Details")
                .sectionHeader()

            Text("Select an app to see usage details, session history, and category.")
                .font(.body)
                .foregroundStyle(.secondary)
        }
    }

    private func shortcutRow(_ label: String, shortcut: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(shortcut)
                .font(.caption.monospaced())
                .foregroundStyle(.tertiary)
                .padding(.horizontal, DS.space4)
                .padding(.vertical, DS.space2)
                .background(Color(.controlBackgroundColor), in: RoundedRectangle(cornerRadius: DS.radiusSmall))
        }
    }
}
