import SwiftUI

/// Top toolbar for date navigation surfaces.
/// Uses a tonal background shift — no divider line.
struct HeaderBar: View {
    var body: some View {
        HStack {
            Spacer()
            DateNavigator()
        }
        .padding(.horizontal, DS.space20)
        .padding(.vertical, DS.space12)
        .background(DS.surfaceLow)
    }
}
