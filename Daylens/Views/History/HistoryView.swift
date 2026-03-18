import SwiftUI

struct HistoryView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = HistoryViewModel()

    var body: some View {
        ScrollView {
            if viewModel.dailySummaries.isEmpty && !viewModel.isLoading {
                EmptyStateView(
                    icon: "clock.arrow.circlepath",
                    title: "No History Yet",
                    description: "Daily summaries will appear here as you use your Mac. History builds up over days of tracking."
                )
            } else {
                VStack(alignment: .leading, spacing: DS.space12) {
                    ForEach(viewModel.dailySummaries) { summary in
                        DaySummaryRow(summary: summary) {
                            appState.selectedDate = summary.date
                            appState.selectedSection = .today
                        }
                    }
                }
                .padding(DS.space24)
            }
        }
        .onAppear { viewModel.load() }
    }
}
