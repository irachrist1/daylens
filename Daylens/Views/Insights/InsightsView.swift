import SwiftUI

struct InsightsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = InsightsViewModel()
    @Namespace private var scrollBottom

    var body: some View {
        ZStack(alignment: .bottom) {
            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: DS.space16) {
                        if viewModel.messages.isEmpty {
                            welcomeContent
                                .padding(.top, DS.space32)
                        }

                        ForEach(Array(viewModel.messages.enumerated()), id: \.offset) { index, message in
                            ChatBubble(role: message.role, content: message.content)
                                .id(index)
                        }

                        if viewModel.isProcessing {
                            TypingIndicator()
                                .padding(.leading, DS.space16)
                                .id("typing")
                        }

                        // Bottom padding so messages aren't hidden behind input bar
                        Color.clear.frame(height: 96).id("bottom")
                    }
                    .padding(.horizontal, DS.space24)
                    .padding(.top, DS.space20)
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

            // Floating input bar
            FloatingInputBar(
                text: $viewModel.inputText,
                isProcessing: viewModel.isProcessing,
                onSubmit: {
                    viewModel.askQuestion(aiService: appState.aiService, date: appState.selectedDate)
                }
            )
        }
    }

    // MARK: - Welcome

    private var welcomeContent: some View {
        VStack(spacing: DS.space32) {
            VStack(spacing: DS.space12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 36, weight: .light))
                    .foregroundStyle(.tint)

                Text("Ask About Your Day")
                    .font(.title2.weight(.semibold))

                Text("Ask anything about your activity — apps used, time spent, focus patterns, or habits.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 420)
            }

            VStack(alignment: .leading, spacing: DS.space8) {
                ForEach(suggestions, id: \.self) { suggestion in
                    SuggestionChip(text: suggestion) {
                        viewModel.inputText = suggestion
                        viewModel.askQuestion(aiService: appState.aiService, date: appState.selectedDate)
                    }
                }
            }

            if !appState.aiService.isConfigured {
                HStack(spacing: DS.space8) {
                    Image(systemName: "key.slash")
                        .foregroundStyle(.orange)
                    Text("Add your Anthropic API key in Settings to enable AI answers.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(DS.space12)
                .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
            }
        }
        .frame(maxWidth: .infinity)
    }

    private let suggestions = [
        "How much time did I spend on YouTube today?",
        "What was my most-used app today?",
        "Was I focused or distracted today?",
        "What did I work on most this week?",
    ]
}

// MARK: - Suggestion Chip

struct SuggestionChip: View {
    let text: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.tint)
                .padding(.horizontal, DS.space12)
                .padding(.vertical, DS.space8)
                .background(
                    RoundedRectangle(cornerRadius: DS.radiusLarge)
                        .fill(Color.accentColor.opacity(0.08))
                        .overlay(
                            RoundedRectangle(cornerRadius: DS.radiusLarge)
                                .strokeBorder(Color.accentColor.opacity(0.2), lineWidth: 0.5)
                        )
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Chat Bubble

struct ChatBubble: View {
    let role: String
    let content: String

    private var isUser: Bool { role == "user" }

    private var renderedContent: AttributedString {
        (try? AttributedString(markdown: content,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(content)
    }

    var body: some View {
        HStack(alignment: .top, spacing: DS.space10) {
            if !isUser {
                ZStack {
                    Circle()
                        .fill(Color.accentColor.opacity(0.12))
                        .frame(width: 28, height: 28)
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.tint)
                }
                .padding(.top, 2)
            }

            Text(renderedContent)
                .font(.body)
                .lineSpacing(5)
                .textSelection(.enabled)
                .padding(.horizontal, DS.space14)
                .padding(.vertical, DS.space10)
                .background(
                    RoundedRectangle(cornerRadius: isUser ? 18 : 14)
                        .fill(isUser
                            ? Color.accentColor
                            : Color(.controlBackgroundColor))
                        .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
                )
                .foregroundStyle(isUser ? Color.white : Color.primary)
                .frame(maxWidth: 560, alignment: isUser ? .trailing : .leading)

            if isUser {
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }
}

// MARK: - Typing Indicator

struct TypingIndicator: View {
    @State private var phase = 0

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { i in
                Circle()
                    .fill(Color.secondary.opacity(phase == i ? 1.0 : 0.3))
                    .frame(width: 6, height: 6)
                    .animation(.easeInOut(duration: 0.5).repeatForever().delay(Double(i) * 0.15), value: phase)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(.controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14))
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
    let onSubmit: () -> Void
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: DS.space10) {
            TextField("Ask about your day...", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.body)
                .lineLimit(1...5)
                .focused($isFocused)
                .onSubmit {
                    if !isProcessing && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        onSubmit()
                    }
                }

            Button(action: onSubmit) {
                ZStack {
                    Circle()
                        .fill(canSend ? Color.accentColor : Color.secondary.opacity(0.2))
                        .frame(width: 30, height: 30)
                    Image(systemName: "arrow.up")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(canSend ? .white : .secondary)
                }
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(.horizontal, DS.space16)
        .padding(.vertical, DS.space12)
        .background {
            RoundedRectangle(cornerRadius: 20)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .strokeBorder(
                            LinearGradient(
                                colors: [Color.primary.opacity(0.15), Color.primary.opacity(0.05)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 0.5
                        )
                )
                .shadow(color: .black.opacity(0.08), radius: 16, y: 4)
        }
        .padding(.horizontal, DS.space24)
        .padding(.bottom, DS.space16)
    }

    private var canSend: Bool {
        !isProcessing && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

private extension DS {
    static let space10: CGFloat = 10
    static let space14: CGFloat = 14
}
