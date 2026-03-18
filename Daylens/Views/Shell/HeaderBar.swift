import SwiftUI

/// Top toolbar bar with section title, search, and date navigation.
struct HeaderBar: View {
    @Environment(AppState.self) private var appState
    @State private var searchText = ""

    var body: some View {
        HStack(spacing: DS.space16) {
            // Section title
            Text(appState.selectedSection.rawValue)
                .font(.title2.weight(.semibold))

            Spacer()

            // Date navigation (shown for data screens)
            if showsDateNavigation {
                DateNavigator()
            }

            // Search field
            HStack(spacing: DS.space4) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.tertiary)
                TextField("Search...", text: $searchText)
                    .textFieldStyle(.plain)
                    .frame(width: 140)
            }
            .padding(.horizontal, DS.space8)
            .padding(.vertical, DS.space4)
            .background(Color(.controlBackgroundColor), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
        }
        .padding(.horizontal, DS.space20)
        .padding(.vertical, DS.space12)
        .background(.bar)
    }

    private var showsDateNavigation: Bool {
        switch appState.selectedSection {
        case .today, .apps, .browsers, .websites, .history:
            return true
        case .insights, .settings:
            return false
        }
    }
}
