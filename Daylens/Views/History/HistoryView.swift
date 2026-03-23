import SwiftUI

/// Browse past days of tracked activity.
struct HistoryView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = HistoryViewModel()
    @State private var selectedFilter: AppCategory? = nil
    @State private var showAllSites = false

    private var aiService: AIService? { appState.aiService }

    var body: some View {
        HStack(spacing: 0) {
            dayList
                .frame(width: 260)
            dayDetail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear { viewModel.loadDays() }
        .onReceive(NotificationCenter.default.publisher(for: .categoryOverrideChanged)) { _ in
            if let date = viewModel.selectedDate {
                viewModel.loadDetail(for: date)
            }
        }
    }

    // MARK: - Day List

    private var dayList: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("History")
                .font(.system(size: 10, weight: .semibold))
                .textCase(.uppercase)
                .tracking(1.0)
                .foregroundStyle(DS.onSurfaceVariant)
                .padding(.horizontal, DS.space16)
                .padding(.vertical, DS.space16)

            if viewModel.days.isEmpty && !viewModel.isLoadingList {
                dayListEmpty
            } else {
                ScrollView {
                    LazyVStack(spacing: DS.space2) {
                        ForEach(viewModel.days) { day in
                            DayRow(
                                snapshot: day,
                                isSelected: viewModel.selectedDate == day.date
                            )
                            .contentShape(Rectangle())
                            .onTapGesture {
                showAllSites = false
                viewModel.selectDay(day.date)
            }
                        }
                    }
                    .padding(.horizontal, DS.space8)
                    .padding(.vertical, DS.space4)
                }
            }
        }
        .background(DS.surfaceLow)
    }

    private var dayListEmpty: some View {
        VStack(spacing: DS.space12) {
            Image(systemName: "calendar")
                .font(.system(size: 28))
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.4))

            Text("No history yet")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(DS.onSurfaceVariant)

            Text("Use your Mac for a day and your activity will appear here.")
                .font(.caption)
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
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
                        categoryFilterPills
                        overviewStats
                        daySummaryCard
                        categoryBreakdown
                        RecentSessionsCard(summaries: filteredSummaries)
                        if shouldShowTopWebsites {
                            topWebsitesSection
                        }
                    }
                }
                .frame(maxWidth: 780, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(DS.space24)
            }
            .background(DS.surfaceContainer)
        } else {
            noSelectionPlaceholder
        }
    }

    private var filteredSummaries: [AppUsageSummary] {
        guard let filter = selectedFilter else { return viewModel.appSummaries }
        return viewModel.appSummaries.filter { $0.category == filter }
    }

    private var filteredCategorySummaries: [CategoryUsageSummary] {
        guard let filter = selectedFilter else { return viewModel.categorySummaries }
        return viewModel.categorySummaries.filter { $0.category == filter }
    }

    private var shouldShowTopWebsites: Bool {
        !visibleSites.isEmpty && (selectedFilter == nil || selectedFilter == .browsing)
    }

    private var visibleSites: [WebsiteUsageSummary] {
        viewModel.websiteSummaries
    }

    private var categoryFilterPills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DS.space8) {
                FilterPill(label: "All", isSelected: selectedFilter == nil) { selectedFilter = nil }
                FilterPill(label: "Focus Work", isSelected: selectedFilter == .development) { selectedFilter = .development }
                FilterPill(label: "Meetings", isSelected: selectedFilter == .meetings) { selectedFilter = .meetings }
                FilterPill(label: "Communication", isSelected: selectedFilter == .communication) { selectedFilter = .communication }
                FilterPill(label: "Browsing", isSelected: selectedFilter == .browsing) { selectedFilter = .browsing }
            }
        }
    }

    private func dayDetailHeader(for date: Date) -> some View {
        VStack(alignment: .leading, spacing: DS.space6) {
            Text(Self.fullDateFormatter.string(from: date).uppercased())
                .font(.system(size: 10, weight: .semibold))
                .tracking(1.0)
                .foregroundStyle(DS.onSurfaceVariant)

            if !viewModel.appSummaries.isEmpty {
                Text("\(viewModel.totalActiveTime) active")
                    .font(.system(size: 40, weight: .bold, design: .default).monospacedDigit())
                    .foregroundStyle(DS.onSurface)
                    .tracking(-0.8)
            }
        }
    }

    private var overviewStats: some View {
        HStack(spacing: DS.space12) {
            StatCard(
                title: "Focus Score",
                value: viewModel.focusScoreText,
                subtitle: viewModel.focusLabel,
                icon: "target",
                color: DS.tertiary
            )
            StatCard(
                title: "Apps Used",
                value: "\(viewModel.appSummaries.count)",
                icon: "square.grid.2x2.fill",
                color: DS.secondary
            )
            StatCard(
                title: "Sites Visited",
                value: "\(viewModel.websiteSummaries.count)",
                icon: "globe",
                color: DS.primary
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
                            .foregroundStyle(DS.primary)
                    }
                    .buttonStyle(.plain)
                }
            }

            if let summary = viewModel.summaryText, !summary.isEmpty {
                MarkdownContent(text: summary)
                    .font(.body)
                    .lineSpacing(5)
                    .foregroundStyle(DS.onSurface.opacity(0.85))
                    .textSelection(.enabled)
            } else {
                Text("No summary available for this day.")
                    .font(.body)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
            }
        }
        .cardStyle()
    }

    private var categoryBreakdown: some View {
        AnyView(
            CategoryBreakdownCard(
                categories: filteredCategorySummaries,
                appSummaries: filteredSummaries
            )
        )
    }

    private var topWebsitesSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            HStack {
                Text("Top Websites")
                    .sectionHeader()
                Spacer()
                if visibleSites.count > 3 {
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) { showAllSites.toggle() }
                    } label: {
                        Text(showAllSites ? "Show less" : "See all")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(DS.primary)
                    }
                    .buttonStyle(.plain)
                }
            }

            let displayed = showAllSites ? visibleSites : Array(visibleSites.prefix(3))
            let maxDuration = visibleSites.first?.totalDuration ?? 1

            ForEach(displayed) { site in
                let domainCat = DomainIntelligence.classify(domain: site.domain)
                let color = domainCat.category != .uncategorized
                    ? DS.categoryColor(for: domainCat.category)
                    : DS.primary
                UsageBar(
                    label: site.domain,
                    duration: site.totalDuration,
                    maxDuration: maxDuration,
                    color: color,
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
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.4))

            Text("No activity tracked this day.")
                .font(.body)
                .foregroundStyle(DS.onSurfaceVariant)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DS.space48)
    }

    private var noSelectionPlaceholder: some View {
        VStack(spacing: DS.space12) {
            Image(systemName: "calendar")
                .font(.system(size: 36))
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.3))

            Text("Select a day to see details")
                .font(.body)
                .foregroundStyle(DS.onSurfaceVariant)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.surfaceContainer)
    }

    // MARK: - Formatters

    private static let fullDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .full
        return f
    }()
}

// MARK: - Filter Pill

private struct FilterPill: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 12, weight: isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? .white : DS.onSurfaceVariant)
                .padding(.horizontal, DS.space12)
                .padding(.vertical, DS.space6)
                .background(
                    isSelected ? DS.primaryContainer : DS.surfaceHighest.opacity(0.6),
                    in: Capsule(style: .continuous)
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Day Row

struct DayRow: View {
    let snapshot: DaySummarySnapshot
    let isSelected: Bool

    var body: some View {
        HStack(spacing: DS.space12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(Self.dayFormatter.string(from: snapshot.date))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(DS.onSurface)

                Text(Self.dateFormatter.string(from: snapshot.date))
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant)
            }

            Spacer(minLength: 0)

            VStack(alignment: .trailing, spacing: 2) {
                Text(snapshot.formattedActiveTime)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(isSelected ? DS.primary : DS.onSurface)

                if let topApp = snapshot.topAppName {
                    Text(topApp)
                        .font(.caption)
                        .foregroundStyle(DS.onSurfaceVariant.opacity(0.6))
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, DS.space12)
        .padding(.vertical, DS.space10)
        .background(
            RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                .fill(isSelected ? DS.primary.opacity(0.12) : Color.clear)
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
