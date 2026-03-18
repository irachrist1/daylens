import SwiftUI

/// Insights and AI conversation view.
/// Combines trend insights with conversational AI Q&A.
struct InsightsView: View {
    @StateObject private var insightsVM = InsightsViewModel()
    @StateObject private var aiVM = AIConversationViewModel()

    var body: some View {
        HSplitView {
            insightsPanel
                .frame(minWidth: 300)

            aiPanel
                .frame(minWidth: 300)
        }
        .background(Theme.Colors.background)
        .task {
            insightsVM.loadInsights()
        }
    }

    // MARK: - Insights Panel

    private var insightsPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.spacing24) {
                Text("Insights")
                    .font(Theme.Typography.largeTitle)
                    .foregroundStyle(Theme.Colors.primaryText)

                if insightsVM.insights.isEmpty {
                    EmptyStateView(
                        icon: "brain.head.profile",
                        title: "No Insights Yet",
                        message: "Insights will appear here as the AI analyzes your activity patterns."
                    )
                } else {
                    ForEach(insightsVM.insights) { insight in
                        InsightCardView(insight: insight)
                    }
                }

                if !insightsVM.recentSummaries.isEmpty {
                    trendSection
                }
            }
            .padding(Theme.spacing24)
        }
    }

    private var trendSection: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            Text("Recent Trends")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Colors.primaryText)

            ForEach(insightsVM.recentSummaries) { summary in
                HStack {
                    Text(DateFormatters.relativeDay(summary.date))
                        .font(Theme.Typography.body)
                        .frame(width: 100, alignment: .leading)

                    Text(DurationFormatter.format(summary.totalActiveTime))
                        .font(Theme.Typography.monoSmall)
                        .foregroundStyle(Theme.Colors.secondaryText)

                    Spacer()

                    Text("Focus: \(DurationFormatter.formatPercentage(summary.focusScore))")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(
                            summary.focusScore > 0.5
                                ? Theme.Colors.focus
                                : Theme.Colors.distraction
                        )
                }
                .padding(Theme.spacing8)
            }
        }
    }

    // MARK: - AI Panel

    private var aiPanel: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Ask AI")
                    .font(Theme.Typography.title3)
                    .foregroundStyle(Theme.Colors.primaryText)
                Spacer()
                Button {
                    aiVM.startNewConversation()
                } label: {
                    Image(systemName: "plus.circle")
                }
                .buttonStyle(.borderless)
            }
            .padding(Theme.spacing16)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: Theme.spacing12) {
                    ForEach(aiVM.messages) { message in
                        AIMessageBubble(message: message)
                    }

                    if aiVM.isProcessing {
                        HStack {
                            ProgressView()
                                .scaleEffect(0.7)
                            Text("Thinking...")
                                .font(Theme.Typography.callout)
                                .foregroundStyle(Theme.Colors.tertiaryText)
                        }
                        .padding(Theme.spacing12)
                    }
                }
                .padding(Theme.spacing16)
            }

            Divider()

            HStack(spacing: Theme.spacing8) {
                TextField("Ask about your activity...", text: $aiVM.inputText)
                    .textFieldStyle(.plain)
                    .font(Theme.Typography.body)
                    .onSubmit {
                        Task { await aiVM.sendMessage() }
                    }

                Button {
                    Task { await aiVM.sendMessage() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(
                            aiVM.inputText.isEmpty
                                ? Theme.Colors.tertiaryText
                                : Theme.Colors.accent
                        )
                }
                .buttonStyle(.plain)
                .disabled(aiVM.inputText.isEmpty || aiVM.isProcessing)
            }
            .padding(Theme.spacing12)
        }
    }
}

struct InsightCardView: View {
    let insight: Insight

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.spacing8) {
            HStack {
                Image(systemName: insight.type.sfSymbol)
                    .foregroundStyle(Theme.Colors.accent)
                Text(insight.title)
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.primaryText)
                Spacer()
            }

            Text(insight.body)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.secondaryText)
                .lineSpacing(3)
        }
        .padding(Theme.spacing16)
        .background(Theme.Colors.groupedBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
    }
}
