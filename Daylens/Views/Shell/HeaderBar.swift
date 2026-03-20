import SwiftUI

/// Top toolbar: date navigation only.
/// Focus controls live exclusively in the sidebar (FocusSidebarButton).
struct HeaderBar: View {
    var body: some View {
        HStack {
            DateNavigator()
            Spacer()
        }
        .padding(.horizontal, DS.space20)
        .padding(.vertical, DS.space12)
        .background(DS.surfaceLow)
    }
}
