import SwiftUI

/// Browse past days of tracked activity.
struct HistoryView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = HistoryViewModel()

    private var aiService: AIService? { appState.aiService }

    var body: some View {
        HStack(spacing: 0) {
            dayList
                .frame(width: 260)
            Divider()
            dayDetail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear { viewModel.loadDays() }
    }

    // MARK: - Day List

    private var dayList: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("History")
                .font(.headline)
                .padding(.horizontal, DS.space16)
                .padding(.vertical, DS.space12)

            Divider()

            if viewModel.days.isEmpty && !viewModel.isLoadingList {
                dayListEmpty
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(viewModel.days) { day in
                            DayRow(
                                snapshot: day,
                                isSelected: viewModel.selectedDate == day.date
                            )
                            .contentShape(Rectangle())
                            .onTapGesture { viewModel.selectDay(day.date) }

                            if day.date != viewModel.days.last?.date {
                                Divider().padding(.leading, DS.space16)
                            }
                        }
                    }
                    .padding(.vertical, DS.space4)
                }
            }
        }
        .background(Color(.windowBackgroundColor))
    }

    private var dayListEmpty: some View {
        VStack(spacing: DS.space12) {
            Image(systemName: "calendar")
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)

            Text("No history yet")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)

            Text("Use your Mac for a day and your activity will appear here.")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DS.space24)
    }

    // MARK: - Day Detail

    @ViewBuilder
    private var dayDetail: some View {
        if let selectedDate = viewModel.selectedDate {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.space24) {
                    dayDetailHeader(for: selectedDate)

                    if viewModel.appSummaries.isEmpty && !viewModel.isLoadingDetail {
                        dayDetailEmpty
                    } else {
                        overviewStats
                        daySummaryCard
                        categoryBreakdown
                        TimelineBand(
                            sessions: viewModel.timeline,
                            categorySummaries: viewModel.categorySummaries
                        )
                        TopAppsCard(summaries: viewModel.appSummaries, date: selectedDate)
                        if !viewModel.websiteSummaries.isEmpty {
                            topWebsitesSection
                        }
                    }
                }
                .frame(maxWidth: 780, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(DS.space24)
            }
        } else {
            noSelectionPlaceholder
        }
    }

    private func dayDetailHeader(for date: Date) -> some View {
        VStack(alignment: .leading, spacing: DS.space4) {
            Text(Self.fullDateFormatter.string(from: date))
                .font(.title2.weight(.semibold))

            if !viewModel.appSummaries.isEmpty {
                Text("\(viewModel.totalActiveTime) active")
                    .font(.title.weight(.bold).monospacedDigit())
                    .padding(.top, DS.space4)
            }
        }
    }

    private var overviewStats: some View {
        HStack(spacing: DS.space16) {
            StatCard(
                title: "Focus Score",
                value: viewModel.focusScoreText,
                subtitle: viewModel.focusLabel,
                icon: "target",
                color: .green
            )
            StatCard(
                title: "Apps Used",
                value: "\(viewModel.appSummaries.count)",
                icon: "square.grid.2x2.fill",
                color: .orange
            )
            StatCard(
                title: "Sites Visited",
                value: "\(viewModel.websiteSummaries.count)",
                icon: "globe",
                color: .purple
            )
        }
    }

    private var daySummaryCard: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack {
                Text("Day Summary")
                    .sectionHeader()

                Spacer()

                if viewModel.isGeneratingSummary {
                    ProgressView()
                        .controlSize(.small)
                        .scaleEffect(0.7)
                } else if let aiService, aiService.isConfigured, !viewModel.hasPersistentSummary {
                    Button {
                        viewModel.generateAISummary(aiService: aiService)
                    } label: {
                        Label("Enhance with AI", systemImage: "sparkles")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.tint)
                    }
                    .buttonStyle(.plain)
                }
            }

            if let summary = viewModel.summaryText, !summary.isEmpty {
                MarkdownContent(text: summary)
                    .font(.body)
                    .lineSpacing(5)
                    .foregroundStyle(.primary.opacity(0.85))
                    .textSelection(.enabled)
            } else {
                Text("No summary available for this day.")
                    .font(.body)
                    .foregroundStyle(.tertiary)
            }
        }
        .cardStyle()
    }

    private var categoryBreakdown: some View {
        AnyView(
            CategoryBreakdownCard(
                categories: viewModel.categorySummaries,
                appSummaries: viewModel.appSummaries
            )
        )
    }

    private var topWebsitesSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Top Websites")
                .sectionHeader()

            let maxDuration = viewModel.websiteSummaries.first?.totalDuration ?? 1

            ForEach(viewModel.websiteSummaries.prefix(5)) { site in
                UsageBar(
                    label: site.domain,
                    duration: site.totalDuration,
                    maxDuration: maxDuration,
                    color: .purple,
                    subtitle: site.topPageTitle
                )
            }
        }
        .cardStyle()
    }

    private var dayDetailEmpty: some View {
        VStack(spacing: DS.space12) {
            Image(systemName: "moon.zzz")
                .font(.system(size: 32))
                .foregroundStyle(.tertiary)

            Text("No activity tracked this day.")
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DS.space48)
    }

    private var noSelectionPlaceholder: some View {
        VStack(spacing: DS.space12) {
            Image(systemName: "calendar")
                .font(.system(size: 36))
                .foregroundStyle(.tertiary)

            Text("Select a day to see details")
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Formatters

    private static let fullDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .full
        return f
    }()
}

// MARK: - Day Row

struct DayRow: View {
    let snapshot: DaySummarySnapshot
    let isSelected: Bool

    var body: some View {
        HStack(spacing: DS.space12) {
            // Date column
            VStack(alignment: .leading, spacing: 2) {
                Text(Self.dayFormatter.string(from: snapshot.date))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(isSelected ? .primary : .primary)

                Text(Self.dateFormatter.string(from: snapshot.date))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            // Summary column
            VStack(alignment: .trailing, spacing: 2) {
                Text(snapshot.formattedActiveTime)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(isSelected ? .primary : .secondary)

                if let topApp = snapshot.topAppName {
                    Text(topApp)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, DS.space16)
        .padding(.vertical, DS.space12)
        .background(
            RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                .fill(isSelected ? Color.accentColor.opacity(0.10) : Color.clear)
                .padding(.horizontal, DS.space4)
        )
        .animation(.easeOut(duration: 0.15), value: isSelected)
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEEE"
        return f
    }()

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMM d, yyyy"
        return f
    }()
}
