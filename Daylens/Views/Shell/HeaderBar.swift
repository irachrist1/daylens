import SwiftUI

/// Top toolbar bar with section title and date navigation.
struct HeaderBar: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        HStack(spacing: DS.space16) {
            Text(appState.selectedSection.rawValue)
                .font(.title2.weight(.semibold))

            Spacer()

            if appState.selectedSection.showsDateNavigation {
                DateNavigator()
            }
        }
        .padding(.horizontal, DS.space20)
        .padding(.vertical, DS.space12)
        .background(.bar)
    }
}
