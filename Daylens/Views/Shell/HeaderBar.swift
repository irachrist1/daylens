import SwiftUI

/// Top toolbar bar used only for date navigation surfaces.
struct HeaderBar: View {
    var body: some View {
        HStack {
            Spacer()
            DateNavigator()
        }
        .padding(.horizontal, DS.space20)
        .padding(.vertical, DS.space12)
        .background()
        .overlay(alignment: .bottom) { Divider() }
    }
}
