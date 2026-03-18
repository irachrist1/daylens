import SwiftUI

struct InsightsView: View {
    @Environment(AppState.self) private var appState
    @State private var viewModel = InsightsViewModel()

    var body: some View {
        VStack(spacing: 0) {
            // Chat messages
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: DS.space16) {
                        if viewModel.messages.isEmpty {
                            welcomeContent
                        }

                        ForEach(Array(viewModel.messages.enumerated()), id: \.offset) { index, message in
                            ChatBubble(role: message.role, content: message.content)
                                .id(index)
                        }

                        if viewModel.isProcessing {
                            HStack(spacing: DS.space8) {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Thinking...")
                                    .font(.body)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.leading, DS.space16)
                        }
                    }
                    .padding(DS.space24)
                }
                .onChange(of: viewModel.messages.count) { _, _ in
                    if let lastIndex = viewModel.messages.indices.last {
                        withAnimation {
                            proxy.scrollTo(lastIndex, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            // Input bar
            ChatInputBar(
                text: $viewModel.inputText,
                isProcessing: viewModel.isProcessing,
                onSubmit: {
                    viewModel.askQuestion(aiService: appState.aiService, date: appState.selectedDate)
                }
            )
        }
    }

    private var welcomeContent: some View {
        VStack(alignment: .leading, spacing: DS.space16) {
            Label("Ask About Your Day", systemImage: "sparkles")
                .font(.title3.weight(.semibold))

            Text("Ask questions about your activity in plain language. For example:")
                .font(.body)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: DS.space8) {
                suggestionButton("How much time did I spend on YouTube today?")
                suggestionButton("What was my most-used app?")
                suggestionButton("Was I focused or distracted today?")
                suggestionButton("Which browser did I use the most?")
            }

            if !appState.aiService.isConfigured {
                HStack(spacing: DS.space8) {
                    Image(systemName: "info.circle")
                        .foregroundStyle(.orange)
                    Text("Add your Anthropic API key in Settings for full AI-powered answers. Basic local analysis works without it.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(DS.space12)
                .background(Color.orange.opacity(0.05), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
            }
        }
    }

    private func suggestionButton(_ text: String) -> some View {
        Button {
            viewModel.inputText = text
            viewModel.askQuestion(aiService: appState.aiService, date: appState.selectedDate)
        } label: {
            Text(text)
                .font(.body)
                .foregroundStyle(.accent)
                .padding(.horizontal, DS.space12)
                .padding(.vertical, DS.space6)
                .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: DS.radiusMedium))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Chat Components

struct ChatBubble: View {
    let role: String
    let content: String

    var body: some View {
        HStack(alignment: .top, spacing: DS.space8) {
            if role == "assistant" {
                Image(systemName: "sparkles")
                    .font(.body)
                    .foregroundStyle(.accent)
                    .frame(width: 24)
            }

            Text(content)
                .font(.body)
                .textSelection(.enabled)
                .lineSpacing(4)
                .padding(DS.space12)
                .background(
                    role == "user"
                        ? Color.accentColor.opacity(0.1)
                        : Color(.controlBackgroundColor),
                    in: RoundedRectangle(cornerRadius: DS.radiusMedium)
                )
                .frame(maxWidth: role == "user" ? 500 : .infinity, alignment: role == "user" ? .trailing : .leading)

            if role == "user" {
                Image(systemName: "person.fill")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 24)
            }
        }
        .frame(maxWidth: .infinity, alignment: role == "user" ? .trailing : .leading)
    }
}

struct ChatInputBar: View {
    @Binding var text: String
    let isProcessing: Bool
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: DS.space8) {
            TextField("Ask about your day...", text: $text)
                .textFieldStyle(.plain)
                .onSubmit { if !isProcessing { onSubmit() } }

            Button(action: onSubmit) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
                    .foregroundStyle(text.isEmpty || isProcessing ? .tertiary : .accent)
            }
            .buttonStyle(.plain)
            .disabled(text.isEmpty || isProcessing)
        }
        .padding(DS.space12)
        .background(.bar)
    }
}
