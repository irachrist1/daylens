import SwiftUI

// MARK: - ReportsView

struct ReportsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = ReportsViewModel()
    @State private var selectedTab: ReportTab = .daily
    @State private var selectedReport: GeneratedReport? = nil

    enum ReportTab: String, CaseIterable {
        case daily = "Daily"
        case weekly = "Weekly"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.space20) {
                // Segmented control
                Picker("", selection: $selectedTab) {
                    ForEach(ReportTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 240)

                if selectedTab == .daily {
                    dailySection
                } else {
                    weeklySection
                }
            }
            .padding(DS.space24)
        }
        .background(DS.surfaceContainer)
        .onAppear { viewModel.loadReports(database: appState.database) }
        .sheet(item: $selectedReport) { report in
            ReportDetailSheet(report: report) { updatedReport in
                viewModel.enhanceWithAI(updatedReport, database: appState.database, aiService: appState.aiService)
            }
            .environment(appState)
        }
    }

    // MARK: - Daily

    private var dailySection: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            HStack {
                Text("Daily Reports")
                    .sectionHeader()
                Spacer()
                Button {
                    viewModel.generateDailyReport(database: appState.database, aiService: appState.aiService)
                } label: {
                    if viewModel.isGenerating {
                        HStack(spacing: DS.space8) {
                            ProgressView().controlSize(.small)
                            Text("Generating…")
                        }
                    } else {
                        Label("Generate Today's Report", systemImage: "doc.badge.plus")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(viewModel.isGenerating)
            }

            if viewModel.dailyReports.isEmpty {
                emptyState(
                    icon: "doc.text",
                    message: "No daily reports yet.\nTap \u{201C}Generate Today\u{2019}s Report\u{201D} to create your first one."
                )
            } else {
                VStack(spacing: DS.space8) {
                    ForEach(viewModel.dailyReports) { report in
                        ReportRow(report: report)
                            .onTapGesture { selectedReport = report }
                    }
                }
            }
        }
    }

    // MARK: - Weekly

    private var weeklySection: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            Text("Weekly Reports")
                .sectionHeader()

            if viewModel.weeklyReports.isEmpty {
                emptyState(
                    icon: "calendar.badge.clock",
                    message: "No weekly reports yet.\nWeekly reports are generated automatically."
                )
            } else {
                VStack(spacing: DS.space8) {
                    ForEach(viewModel.weeklyReports) { report in
                        ReportRow(report: report)
                            .onTapGesture { selectedReport = report }
                    }
                }
            }
        }
    }

    // MARK: - Empty state

    private func emptyState(icon: String, message: String) -> some View {
        VStack(spacing: DS.space12) {
            Image(systemName: icon)
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
            Text(message)
                .font(.callout)
                .foregroundStyle(DS.onSurfaceVariant)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity)
        .padding(DS.space32)
        .cardStyle()
    }
}

// MARK: - ReportRow

private struct ReportRow: View {
    let report: GeneratedReport

    private var dateLabel: String {
        let df = DateFormatter()
        df.dateStyle = .medium
        df.timeStyle = .none
        return df.string(from: report.periodStart)
    }

    private var firstLine: String {
        report.markdownContent
            .components(separatedBy: .newlines)
            .first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty && !$0.hasPrefix("#") })
            ?? ""
    }

    var body: some View {
        HStack(alignment: .top, spacing: DS.space12) {
            Image(systemName: "doc.text")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(DS.onSurfaceVariant)
                .frame(width: 18)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: DS.space4) {
                HStack(spacing: DS.space8) {
                    Text(dateLabel)
                        .font(.body.weight(.medium))
                        .foregroundStyle(DS.onSurface)
                    if report.generatedByAI {
                        Label("AI Enhanced", systemImage: "sparkles")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(DS.primary)
                            .padding(.horizontal, DS.space6)
                            .padding(.vertical, 2)
                            .background(DS.primaryContainer.opacity(0.4), in: Capsule())
                    }
                    Spacer()
                    Text(report.createdAt, style: .relative)
                        .font(.caption)
                        .foregroundStyle(DS.onSurfaceVariant)
                }
                if !firstLine.isEmpty {
                    Text(firstLine)
                        .font(.callout)
                        .foregroundStyle(DS.onSurfaceVariant)
                        .lineLimit(2)
                }
            }
        }
        .padding(DS.space16)
        .cardStyle()
    }
}

// MARK: - ReportDetailSheet

struct ReportDetailSheet: View {
    let report: GeneratedReport
    let onEnhance: (GeneratedReport) -> Void

    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: DS.space4) {
                    Text(report.reportType == "daily" ? "Daily Report" : "Weekly Report")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(DS.onSurface)
                    Text(report.periodStart, style: .date)
                        .font(.callout)
                        .foregroundStyle(DS.onSurfaceVariant)
                }
                Spacer()
                if !report.generatedByAI && appState.aiService.isConfigured {
                    Button {
                        onEnhance(report)
                        dismiss()
                    } label: {
                        Label("Enhance with AI", systemImage: "sparkles")
                    }
                    .buttonStyle(.bordered)
                }
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, DS.space24)
            .padding(.vertical, DS.space16)
            .background(DS.surfaceContainer)

            Divider()

            ScrollView {
                MarkdownContent(text: report.markdownContent)
                    .padding(DS.space24)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(minWidth: 560, minHeight: 480)
        .background(DS.surfaceContainer)
    }
}
