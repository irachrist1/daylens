import SwiftUI

/// Right detail/inspector panel showing contextual information.
struct InspectorPanel: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space20) {
                Text("Keyboard Shortcuts")
                    .sectionHeader()

                VStack(alignment: .leading, spacing: DS.space6) {
                    shortcutRow("Previous day", shortcut: "⌘ [")
                    shortcutRow("Next day", shortcut: "⌘ ]")
                    shortcutRow("Today", shortcut: "⌘ T")
                }
            }
            .padding(DS.space20)
        }
        .background(Color(.windowBackgroundColor))
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
