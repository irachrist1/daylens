import SwiftUI

struct InsightsView: View {
    @Environment(AppState.self) private var appState
    @Namespace private var composerTransition

    private var viewModel: InsightsViewModel { appState.insightsViewModel }
    private var aiService: AIService? { appState.aiService }
    private var hasConversation: Bool { !viewModel.messages.isEmpty }

    private var inputBinding: Binding<String> {
        Binding(
            get: { appState.insightsViewModel.inputText },
            set: { appState.insightsViewModel.inputText = $0 }
        )
    }

    private var modelBinding: Binding<String> {
        Binding(
            get: { appState.aiService?.model ?? Constants.defaultAIModel },
            set: { appState.aiService?.setModel($0) }
        )
    }

    var body: some View {
        ZStack {
            DS.surfaceContainer.ignoresSafeArea()

            if hasConversation {
                conversationLayout
                    .transition(.opacity)
            } else {
                emptyStateLayout
                    .transition(.opacity.combined(with: .scale(scale: 0.985)))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeInOut(duration: 0.24), value: hasConversation)
        .onAppear { viewModel.loadPersistedConversation() }
    }

    private var emptyStateLayout: some View {
        VStack {
            Spacer(minLength: DS.space24)

            VStack(spacing: DS.space28) {
                welcomeContent

                composerView
                    .matchedGeometryEffect(id: "insights-composer", in: composerTransition)
                    .frame(maxWidth: 680)
            }
            .frame(maxWidth: .infinity)

            Spacer(minLength: DS.space24)
        }
        .padding(.horizontal, DS.space24)
        .padding(.vertical, DS.space32)
    }

    private var conversationLayout: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: DS.space20) {
                        HStack {
                            Spacer()

                            Button {
                                withAnimation(.easeInOut(duration: 0.24)) {
                                    viewModel.clearConversation()
                                }
                            } label: {
                                Label("New chat", systemImage: "plus")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(DS.onSurfaceVariant)
                                    .padding(.horizontal, DS.space12)
                                    .padding(.vertical, DS.space8)
                                    .background(DS.surfaceCard, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .disabled(viewModel.isProcessing)
                        }

                        ForEach(viewModel.messages) { message in
                            ChatBubble(message: message)
                                .transition(.opacity.combined(with: .offset(y: 8)))
                        }

                        if viewModel.isProcessing {
                            TypingIndicator()
                                .padding(.leading, DS.space16)
                                .id("typing")
                        }

                        Color.clear
                            .frame(height: DS.space12)
                            .id("bottom")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, DS.space24)
                    .padding(.top, DS.space24)
                    .padding(.bottom, DS.space20)
                    .animation(.easeOut(duration: 0.25), value: viewModel.messages.count)
                }
                .onChange(of: viewModel.messages.count) { _, _ in
                    withAnimation(.easeOut(duration: 0.25)) {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
                .onChange(of: viewModel.isProcessing) { _, _ in
                    withAnimation(.easeOut(duration: 0.25)) {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
            }

            // Tonal separator — no Divider line
            composerView
                .matchedGeometryEffect(id: "insights-composer", in: composerTransition)
                .padding(.horizontal, DS.space24)
                .padding(.top, DS.space12)
                .padding(.bottom, DS.space16)
                .background(DS.surfaceLow)
        }
    }

    private var welcomeContent: some View {
        VStack(spacing: DS.space24) {
            ZStack {
                Circle()
                    .fill(DS.primary.opacity(0.10))
                    .frame(width: 58, height: 58)

                Image(systemName: "sparkles")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(DS.primary)
            }

            Text("Ask about your day")
                .font(.system(.title2, design: .default, weight: .semibold))
                .foregroundStyle(DS.onSurface)
                .multilineTextAlignment(.center)

            VStack(alignment: .leading, spacing: DS.space10) {
                ForEach(suggestions, id: \.self) { suggestion in
                    SuggestionChip(text: suggestion) {
                        viewModel.inputText = suggestion
                        submitCurrentQuestion()
                    }
                }
            }
            .frame(maxWidth: 520)
        }
        .frame(maxWidth: .infinity)
    }

    private var composerView: some View {
        FloatingInputBar(
            text: inputBinding,
            isProcessing: viewModel.isProcessing,
            selectedModel: modelBinding,
            availableModels: Constants.anthropicModels,
            onSubmit: submitCurrentQuestion
        )
    }

    private func submitCurrentQuestion() {
        guard let aiService else { return }
        viewModel.askQuestion(aiService: aiService, date: appState.selectedDate)
    }

    private let suggestions = [
        "What was my most-used app today?",
        "Was I focused today?",
        "Where did my time go today?",
    ]
}

// MARK: - Suggestion Chip

struct SuggestionChip: View {
    let text: String
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: DS.space10) {
                Text(text)
                    .font(.subheadline)
                    .foregroundStyle(DS.onSurface)
                    .multilineTextAlignment(.leading)

                Spacer(minLength: 0)

                Image(systemName: "arrow.up.left")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, DS.space14)
            .padding(.vertical, DS.space10)
            .background(
                RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                    .fill(isHovered ? DS.surfaceHighest : DS.surfaceHigh)
            )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .animation(.easeOut(duration: 0.12), value: isHovered)
    }
}

// MARK: - Chat Bubble

struct ChatBubble: View {
    let message: ChatMessage

    private var isUser: Bool { message.isUser }
    private var isError: Bool { message.role == .error }
    private var isAssistant: Bool { message.role == .assistant }

    var body: some View {
        HStack(alignment: .top, spacing: DS.space12) {
            if isUser {
                Spacer(minLength: 72)
            } else {
                InsightAvatar(isError: isError)
            }

            VStack(alignment: .leading, spacing: DS.space6) {
                if !isUser {
                    Text(isError ? "Couldn't answer" : "Daylens")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(isError ? DS.secondary : DS.onSurfaceVariant)
                        .padding(.leading, DS.space4)
                }

                messageText
                    .font(.body)
                    .lineSpacing(6)
                    .textSelection(.enabled)
                    .padding(.horizontal, DS.space16)
                    .padding(.vertical, DS.space14)
                    .background { bubbleBackgroundView }
                    .foregroundStyle(isUser ? DS.onPrimaryFixed : DS.onSurface)
            }
            .frame(maxWidth: 620, alignment: isUser ? .trailing : .leading)

            if !isUser {
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    @ViewBuilder
    private var bubbleBackgroundView: some View {
        if isUser {
            RoundedRectangle(cornerRadius: isUser ? 18 : 16, style: .continuous)
                .fill(DS.primaryContainer)
        } else if isError {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(DS.secondary.opacity(0.10))
        } else {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(DS.surfaceCard)
        }
    }

    @ViewBuilder
    private var messageText: some View {
        if isAssistant || isError {
            MarkdownContent(text: message.content)
        } else {
            Text(message.content)
        }
    }
}

struct InsightAvatar: View {
    let isError: Bool

    var body: some View {
        ZStack {
            Circle()
                .fill(isError ? DS.secondary.opacity(0.12) : DS.primary.opacity(0.12))
                .frame(width: 30, height: 30)
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "sparkles")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(isError ? DS.secondary : DS.primary)
        }
        .padding(.top, 2)
    }
}

// MARK: - Typing Indicator

struct TypingIndicator: View {
    @State private var phase = 0

    var body: some View {
        HStack(alignment: .top, spacing: DS.space12) {
            InsightAvatar(isError: false)

            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(DS.onSurfaceVariant.opacity(phase == i ? 0.8 : 0.25))
                        .frame(width: 6, height: 6)
                        .animation(.easeInOut(duration: 0.5).repeatForever().delay(Double(i) * 0.15), value: phase)
                }
            }
            .padding(.horizontal, DS.space14)
            .padding(.vertical, DS.space12)
            .background(DS.surfaceCard, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            Spacer(minLength: 0)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 0.5).repeatForever()) {
                phase = 1
            }
        }
    }
}

// MARK: - Floating Input Bar

struct FloatingInputBar: View {
    @Binding var text: String
    let isProcessing: Bool
    @Binding var selectedModel: String
    let availableModels: [Constants.AIModelOption]
    let onSubmit: () -> Void
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            ZStack(alignment: .topLeading) {
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(placeholderText)
                        .font(.body)
                        .foregroundStyle(DS.onSurfaceVariant.opacity(0.4))
                        .padding(.horizontal, DS.space18)
                        .padding(.top, DS.space16)
                }

                TextField("", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.body)
                    .foregroundStyle(DS.onSurface)
                    .lineLimit(1...6)
                    .focused($isFocused)
                    .onSubmit {
                        if canSend { onSubmit() }
                    }
                    .padding(.horizontal, DS.space18)
                    .padding(.top, DS.space16)
                    .padding(.bottom, DS.space8)
            }

            HStack(spacing: DS.space12) {
                Menu {
                    ForEach(availableModels) { model in
                        Button(model.name) { selectedModel = model.id }
                    }
                } label: {
                    HStack(spacing: DS.space6) {
                        Text(selectedModelLabel)
                            .font(.caption.weight(.medium))
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .foregroundStyle(DS.onSurfaceVariant)
                    .padding(.horizontal, DS.space12)
                    .padding(.vertical, DS.space8)
                    .background(DS.surfaceHighest, in: Capsule())
                }
                .buttonStyle(.plain)

                Spacer()

                // Primary send button with gradient fill
                Button(action: onSubmit) {
                    ZStack {
                        Circle()
                            .fill(canSend ? AnyShapeStyle(DS.primary) : AnyShapeStyle(DS.surfaceHighest))
                            .frame(width: 36, height: 36)
                        if isProcessing {
                            ProgressView()
                                .scaleEffect(0.62)
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(canSend ? DS.onPrimaryFixed : DS.onSurfaceVariant.opacity(0.4))
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
            }
            .padding(.horizontal, DS.space14)
            .padding(.bottom, DS.space14)
        }
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(DS.surfaceCard)
                .overlay(
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .strokeBorder(
                            isFocused ? DS.primary.opacity(0.25) : Color.white.opacity(0.05),
                            lineWidth: isFocused ? 1.5 : 1
                        )
                )
                // Active: 2px primary glow on bottom edge only (spec)
                .shadow(color: isFocused ? DS.primary.opacity(0.12) : .clear, radius: 12, y: 4)
        }
    }

    private var canSend: Bool {
        !isProcessing && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var placeholderText: String {
        if isProcessing { return "Thinking..." }
        return "Ask about your day..."
    }

    private var selectedModelLabel: String {
        availableModels.first(where: { $0.id == selectedModel })?.shortName ?? "Claude"
    }
}

// MARK: - Markdown Content Renderer

struct MarkdownContent: View {
    let text: String
    /// Pre-parsed blocks — computed once at init time, not on every render pass.
    private let blocks: [MarkdownBlock]

    init(text: String) {
        self.text = text
        self.blocks = Self.parse(text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block {
        case .heading(let level, let content):
            inlineText(content)
                .font(headingFont(level))
                .textSelection(.enabled)
                .padding(.top, level == 1 ? 8 : 4)

        case .paragraph(let content):
            inlineText(content)
                .font(.body)
                .textSelection(.enabled)

        case .bullets(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("•")
                            .foregroundStyle(DS.onSurfaceVariant)
                        inlineText(item)
                            .textSelection(.enabled)
                    }
                }
            }
            .font(.body)

        case .numberedList(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(i + 1).")
                            .foregroundStyle(DS.onSurfaceVariant)
                            .monospacedDigit()
                            .frame(minWidth: 18, alignment: .trailing)
                        inlineText(item)
                            .textSelection(.enabled)
                    }
                }
            }
            .font(.body)

        case .table(let headers, let rows):
            MarkdownTable(headers: headers, rows: rows)

        case .codeBlock(let code):
            Text(code)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(DS.onSurface)
                .textSelection(.enabled)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DS.surfaceHighest, in: RoundedRectangle(cornerRadius: 8, style: .continuous))

        case .horizontalRule:
            Rectangle()
                .fill(DS.outlineVariant.opacity(0.5))
                .frame(height: 1)
                .padding(.vertical, 2)
        }
    }

    private func inlineText(_ content: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: content,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attributed)
        }
        return Text(content)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .system(size: 17, weight: .bold)
        case 2: .system(size: 15, weight: .semibold)
        default: .system(size: 13, weight: .semibold)
        }
    }

    // MARK: - Parser

    enum MarkdownBlock {
        case heading(level: Int, text: String)
        case paragraph(String)
        case bullets([String])
        case numberedList([String])
        case table(headers: [String], rows: [[String]])
        case codeBlock(String)
        case horizontalRule
    }

    /// Returns true if `s` starts with "N. " (numbered list prefix).
    private static func isNumberedListLine(_ s: String) -> Bool {
        guard !s.isEmpty, s.first!.isNumber else { return false }
        var idx = s.startIndex
        while idx < s.endIndex, s[idx].isNumber { s.formIndex(after: &idx) }
        guard idx < s.endIndex, s[idx] == "." else { return false }
        s.formIndex(after: &idx)
        return idx < s.endIndex && s[idx] == " "
    }

    /// Extracts the content after "N. " prefix. Nil if not a numbered list line.
    private static func numberedListContent(_ s: String) -> String? {
        guard isNumberedListLine(s) else { return nil }
        var idx = s.startIndex
        while idx < s.endIndex, s[idx].isNumber { s.formIndex(after: &idx) }
        s.formIndex(after: &idx) // skip "."
        s.formIndex(after: &idx) // skip " "
        return String(s[idx...])
    }

    static func parse(_ text: String) -> [MarkdownBlock] {
        let lines = text.components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var i = 0

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty { i += 1; continue }

            if trimmed.hasPrefix("```") {
                var codeLines: [String] = []
                i += 1
                while i < lines.count {
                    if lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") { i += 1; break }
                    codeLines.append(lines[i])
                    i += 1
                }
                blocks.append(.codeBlock(codeLines.joined(separator: "\n")))
                continue
            }

            if trimmed.hasPrefix("#") {
                let level = trimmed.prefix(while: { $0 == "#" }).count
                let content = String(trimmed.dropFirst(level)).trimmingCharacters(in: .whitespaces)
                if level <= 6, !content.isEmpty {
                    blocks.append(.heading(level: level, text: content))
                    i += 1
                    continue
                }
            }

            if trimmed.count >= 3,
               Set(trimmed.filter { !$0.isWhitespace }).count == 1,
               ["-", "*", "_"].contains(trimmed.first) {
                blocks.append(.horizontalRule)
                i += 1
                continue
            }

            if trimmed.hasPrefix("|") {
                var tableLines: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    tableLines.append(lines[i])
                    i += 1
                }
                if let table = parseTable(tableLines) { blocks.append(table) }
                continue
            }

            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
                var items: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    if t.hasPrefix("- ") || t.hasPrefix("* ") || t.hasPrefix("+ ") {
                        items.append(String(t.dropFirst(2))); i += 1
                    } else if t.isEmpty { i += 1; break } else { break }
                }
                blocks.append(.bullets(items))
                continue
            }

            if isNumberedListLine(trimmed) {
                var items: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    if isNumberedListLine(t), let content = numberedListContent(t) {
                        items.append(content); i += 1
                    } else if t.isEmpty { i += 1; break } else { break }
                }
                blocks.append(.numberedList(items))
                continue
            }

            var paraLines: [String] = []
            while i < lines.count {
                let t = lines[i].trimmingCharacters(in: .whitespaces)
                if t.isEmpty || t.hasPrefix("#") || t.hasPrefix("```")
                    || t.hasPrefix("|") || t.hasPrefix("- ") || t.hasPrefix("* ")
                    || t.hasPrefix("+ ") || isNumberedListLine(t) { break }
                if t.count >= 3, Set(t.filter { !$0.isWhitespace }).count == 1,
                   ["-", "*", "_"].contains(t.first) { break }
                paraLines.append(t)
                i += 1
            }
            if !paraLines.isEmpty {
                blocks.append(.paragraph(paraLines.joined(separator: " ")))
            }
        }

        return blocks
    }

    private static func parseTable(_ lines: [String]) -> MarkdownBlock? {
        guard lines.count >= 2 else { return nil }

        func parseCells(_ line: String) -> [String] {
            line.trimmingCharacters(in: .whitespaces)
                .trimmingCharacters(in: CharacterSet(charactersIn: "|"))
                .components(separatedBy: "|")
                .map { $0.trimmingCharacters(in: .whitespaces) }
        }

        let headers = parseCells(lines[0])
        let startRow: Int
        if lines.count > 1 {
            let sep = lines[1].trimmingCharacters(in: .whitespaces)
            startRow = sep.allSatisfy({ $0 == "|" || $0 == "-" || $0 == ":" || $0 == " " }) ? 2 : 1
        } else {
            startRow = 1
        }

        var rows: [[String]] = []
        for r in startRow..<lines.count {
            let cells = parseCells(lines[r])
            if !cells.isEmpty { rows.append(cells) }
        }

        return .table(headers: headers, rows: rows)
    }
}

// MARK: - Markdown Table

struct MarkdownTable: View {
    let headers: [String]
    let rows: [[String]]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header row
            HStack(spacing: 0) {
                ForEach(Array(headers.enumerated()), id: \.offset) { _, header in
                    Text(header)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(DS.onSurface)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 10)
                }
            }
            .background(DS.surfaceHighest.opacity(0.6))

            // Divider
            Rectangle()
                .fill(DS.outlineVariant)
                .frame(height: 1)

            // Data rows
            ForEach(Array(rows.enumerated()), id: \.offset) { rowIdx, row in
                HStack(spacing: 0) {
                    ForEach(Array(row.enumerated()), id: \.offset) { colIdx, cell in
                        Text(cell)
                            .font(.callout)
                            .foregroundStyle(colIdx == 0 ? DS.onSurface : DS.onSurfaceVariant)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 7)
                            .padding(.horizontal, 10)
                    }
                }
                .background(rowIdx % 2 == 0 ? Color.clear : DS.surfaceHighest.opacity(0.3))

                if rowIdx < rows.count - 1 {
                    Rectangle()
                        .fill(DS.outlineVariant.opacity(0.4))
                        .frame(height: 1)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(DS.outlineVariant, lineWidth: 1)
        )
    }
}
