import SwiftUI

// MARK: - ReportsView

struct ReportsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = ReportsViewModel()
    @State private var selectedTab: ReportTab = .daily
    @State private var selectedReportID: Int64? = nil

    enum ReportTab: String, CaseIterable {
        case daily = "Daily"
        case weekly = "Weekly"
    }

    private var currentReports: [GeneratedReport] {
        selectedTab == .daily ? viewModel.dailyReports : viewModel.weeklyReports
    }

    private var displayedReport: GeneratedReport? {
        guard let id = selectedReportID else { return nil }
        return viewModel.reports.first { $0.id == id }
    }

    var body: some View {
        HStack(spacing: 0) {
            listPanel
                .frame(minWidth: 280, maxWidth: 320)
                .background(DS.surfaceLow)

            Divider()

            if let report = displayedReport {
                ReportDetailPanel(
                    report: report,
                    onEnhance: {
                        viewModel.enhanceWithAI(report, database: appState.database, aiService: appState.aiService)
                    }
                )
                .environment(appState)
            } else {
                emptyDetailState
            }
        }
        .background(DS.surfaceContainer)
        .onAppear { viewModel.loadReports(database: appState.database) }
    }

    // MARK: - List panel

    private var listPanel: some View {
        VStack(spacing: 0) {
            Picker("", selection: $selectedTab) {
                ForEach(ReportTab.allCases, id: \.self) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(DS.space16)

            Divider()

            ScrollView {
                VStack(spacing: DS.space6) {
                    if currentReports.isEmpty {
                        emptyListState
                            .padding(.top, DS.space32)
                    } else {
                        ForEach(currentReports) { report in
                            ReportListRow(
                                report: report,
                                isSelected: selectedReportID == report.id
                            )
                            .onTapGesture { selectedReportID = report.id }
                        }
                    }
                }
                .padding(DS.space12)
            }

            Divider()

            Button {
                if selectedTab == .daily {
                    viewModel.generateDailyReport(database: appState.database, aiService: appState.aiService)
                } else {
                    viewModel.generateWeeklyReport(database: appState.database, aiService: appState.aiService)
                }
            } label: {
                if viewModel.isGenerating {
                    HStack(spacing: DS.space8) {
                        ProgressView().controlSize(.small)
                        Text("Generating…")
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Label(
                        selectedTab == .daily ? "Generate Today's Report" : "Generate This Week's Report",
                        systemImage: selectedTab == .daily ? "doc.badge.plus" : "calendar.badge.plus"
                    )
                    .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            .disabled(viewModel.isGenerating)
            .padding(DS.space16)
        }
    }

    private var emptyListState: some View {
        VStack(spacing: DS.space12) {
            Image(systemName: selectedTab == .daily ? "doc.text" : "calendar.badge.clock")
                .font(.system(size: 24, weight: .light))
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.4))
            Text(selectedTab == .daily ? "No daily reports yet." : "No weekly reports yet.")
                .font(.callout)
                .foregroundStyle(DS.onSurfaceVariant)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(DS.space16)
    }

    // MARK: - Empty detail state

    private var emptyDetailState: some View {
        VStack(spacing: DS.space16) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 48, weight: .ultraLight))
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.3))
            Text("Select a report or generate today's")
                .font(.title3)
                .foregroundStyle(DS.onSurfaceVariant.opacity(0.55))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.surfaceContainer)
    }

    // MARK: - Plain text preview helper

    static func plainTextPreview(_ markdown: String) -> String {
        markdown
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "__", with: "")
            .replacingOccurrences(of: "## ", with: "")
            .replacingOccurrences(of: "# ", with: "")
            .replacingOccurrences(of: "- ", with: "")
            .components(separatedBy: "\n")
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            .prefix(2)
            .joined(separator: " · ")
    }
}

// MARK: - ReportListRow

private struct ReportListRow: View {
    let report: GeneratedReport
    let isSelected: Bool

    private var dateLabel: String {
        let df = DateFormatter()
        df.dateStyle = .medium
        df.timeStyle = .none
        return df.string(from: report.periodStart)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space6) {
            HStack(spacing: DS.space8) {
                Text(dateLabel)
                    .font(.body.weight(.medium))
                    .foregroundStyle(DS.onSurface)
                Spacer()
                if report.generatedByAI {
                    Label("AI", systemImage: "sparkles")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(DS.primary)
                        .padding(.horizontal, DS.space6)
                        .padding(.vertical, 2)
                        .background(DS.primaryContainer.opacity(0.4), in: Capsule())
                }
            }

            let preview = ReportsView.plainTextPreview(report.markdownContent)
            if !preview.isEmpty {
                Text(preview)
                    .font(.callout)
                    .foregroundStyle(DS.onSurfaceVariant)
                    .lineLimit(2)
            }
        }
        .padding(DS.space12)
        .background(
            RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                .fill(isSelected ? DS.primary.opacity(0.1) : DS.surfaceContainer)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                .strokeBorder(
                    isSelected ? DS.primary.opacity(0.4) : DS.outlineVariant,
                    lineWidth: isSelected ? 1.5 : 1
                )
        )
    }
}

// MARK: - ReportDetailPanel

private struct ReportDetailPanel: View {
    let report: GeneratedReport
    let onEnhance: () -> Void

    @Environment(AppState.self) private var appState

    private var dateLabel: String {
        let df = DateFormatter()
        df.dateStyle = .full
        return df.string(from: report.periodStart)
    }

    private var totalTime: String {
        extractValue("Total active time:", from: report.markdownContent) ?? "—"
    }

    private var focusQuality: String {
        extractPercent(from: report.markdownContent) ?? "—"
    }

    private var sessionsCount: String {
        extractValue("Focus sessions completed:", from: report.markdownContent) ?? "—"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: DS.space4) {
                    Text(report.reportType == "daily" ? "Daily Report" : "Weekly Report")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(DS.onSurface)
                    Text(dateLabel)
                        .font(.callout)
                        .foregroundStyle(DS.onSurfaceVariant)
                }
                Spacer()
                HStack(spacing: DS.space8) {
                    if !report.generatedByAI && appState.aiService.isConfigured {
                        Button {
                            onEnhance()
                        } label: {
                            Label("Enhance with AI", systemImage: "sparkles")
                        }
                        .buttonStyle(.bordered)
                    }
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(report.markdownContent, forType: .string)
                    } label: {
                        Label("Copy", systemImage: "doc.on.clipboard")
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(.horizontal, DS.space24)
            .padding(.vertical, DS.space16)
            .background(DS.surfaceContainer)

            Divider()

            // Stat cards row
            HStack(spacing: DS.space12) {
                ReportStatCard(title: "Total Time", value: totalTime, icon: "clock.fill", color: DS.primary)
                ReportStatCard(title: "Focus Quality", value: focusQuality, icon: "target", color: DS.tertiary)
                ReportStatCard(title: "Sessions", value: sessionsCount, icon: "checkmark.circle.fill", color: DS.secondary)
            }
            .padding(.horizontal, DS.space20)
            .padding(.vertical, DS.space12)
            .background(DS.surfaceLow)

            Divider()

            // Full markdown content
            ScrollView {
                MarkdownContent(text: report.markdownContent)
                    .padding(DS.space24)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func extractValue(_ key: String, from text: String) -> String? {
        guard let range = text.range(of: key) else { return nil }
        let after = String(text[range.upperBound...])
        let value = after
            .components(separatedBy: .newlines).first?
            .trimmingCharacters(in: .whitespaces)
            .components(separatedBy: " (").first?
            .replacingOccurrences(of: "**", with: "")
            .trimmingCharacters(in: .whitespaces)
        return value?.isEmpty == false ? value : nil
    }

    private func extractPercent(from text: String) -> String? {
        guard let range = text.range(of: "Focus quality:") else { return nil }
        let after = String(text[range.upperBound...]).trimmingCharacters(in: .whitespaces)
        if let pctRange = after.range(of: #"\d+%"#, options: .regularExpression) {
            return String(after[pctRange])
        }
        return nil
    }
}

// MARK: - ReportStatCard

private struct ReportStatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space4) {
            HStack(spacing: DS.space6) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(color)
                Text(title.uppercased())
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(0.4)
                    .foregroundStyle(DS.onSurfaceVariant)
            }
            Text(value)
                .font(.system(size: 15, weight: .bold).monospacedDigit())
                .foregroundStyle(DS.onSurface)
                .lineLimit(1)
        }
        .padding(DS.space12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }
}
