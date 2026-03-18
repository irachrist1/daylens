import SwiftUI

/// Standalone chat view that can be used in the inspector or as a sheet.
struct ChatView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = InsightsViewModel()

    var body: some View {
        InsightsView()
    }
}
