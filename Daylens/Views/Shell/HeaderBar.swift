import SwiftUI

/// Top toolbar: date navigation only.
/// Focus controls live exclusively in the sidebar (FocusSidebarButton).
struct HeaderBar: View {
    var body: some View {
        HStack {
            DateNavigator()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, DS.space20)
        .padding(.top, DS.space6)
    }
}
