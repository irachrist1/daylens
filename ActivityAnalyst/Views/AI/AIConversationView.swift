import SwiftUI

/// Standalone AI conversation view for deep Q&A sessions.
struct AIConversationView: View {
    @StateObject private var viewModel = AIConversationViewModel()

    var body: some View {
        VStack(spacing: 0) {
            conversationHeader

            Divider()

            messageList

            Divider()

            inputBar
        }
        .background(Theme.Colors.background)
    }

    private var conversationHeader: some View {
        HStack {
            Image(systemName: "brain.head.profile")
                .foregroundStyle(Theme.Colors.accent)

            Text(viewModel.currentConversation?.title ?? "New Conversation")
                .font(Theme.Typography.title3)
                .foregroundStyle(Theme.Colors.primaryText)

            Spacer()

            Menu {
                Button("New Conversation") {
                    viewModel.startNewConversation()
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
        }
        .padding(Theme.spacing16)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Theme.spacing16) {
                    if viewModel.messages.isEmpty {
                        aiWelcomeMessage
                    }

                    ForEach(viewModel.messages) { message in
                        AIMessageBubble(message: message)
                            .id(message.id)
                    }

                    if viewModel.isProcessing {
                        thinkingIndicator
                    }
                }
                .padding(Theme.spacing16)
            }
            .onChange(of: viewModel.messages.count) { _, _ in
                if let lastId = viewModel.messages.last?.id {
                    withAnimation {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var aiWelcomeMessage: some View {
        VStack(alignment: .leading, spacing: Theme.spacing12) {
            Text("Hello! I'm your activity analyst.")
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.primaryText)

            Text("Ask me anything about your computer usage. For example:")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.secondaryText)

            VStack(alignment: .leading, spacing: Theme.spacing6) {
                suggestionButton("How much time did I spend on YouTube today?")
                suggestionButton("What was my most productive hour?")
                suggestionButton("Which browser did I use the most this week?")
                suggestionButton("Am I spending too much time on social media?")
            }
        }
        .padding(Theme.spacing16)
        .background(Theme.Colors.accentSubtle)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
    }

    private func suggestionButton(_ text: String) -> some View {
        Button {
            viewModel.inputText = text
            viewModel.sendMessage()
        } label: {
            Text(text)
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.accent)
        }
        .buttonStyle(.plain)
    }

    private var thinkingIndicator: some View {
        HStack(spacing: Theme.spacing8) {
            ProgressView()
                .scaleEffect(0.7)
            Text("Analyzing your activity data...")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.tertiaryText)
        }
        .padding(Theme.spacing12)
    }

    private var inputBar: some View {
        HStack(spacing: Theme.spacing8) {
            TextField("Ask about your activity...", text: $viewModel.inputText, axis: .vertical)
                .textFieldStyle(.plain)
                .font(Theme.Typography.body)
                .lineLimit(1...4)
                .onSubmit {
                    viewModel.sendMessage()
                }

            Button {
                viewModel.sendMessage()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(
                        viewModel.inputText.isEmpty
                            ? Theme.Colors.tertiaryText
                            : Theme.Colors.accent
                    )
            }
            .buttonStyle(.plain)
            .disabled(viewModel.inputText.isEmpty || viewModel.isProcessing)
        }
        .padding(Theme.spacing16)
    }
}

struct AIMessageBubble: View {
    let message: AIMessage

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: Theme.spacing4) {
            HStack {
                if message.role == .user { Spacer() }

                VStack(alignment: .leading, spacing: Theme.spacing8) {
                    Text(message.content)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.primaryText)
                        .lineSpacing(3)

                    if let evidence = message.evidence, !evidence.isEmpty {
                        evidenceSection(evidence)
                    }
                }
                .padding(Theme.spacing12)
                .background(
                    message.role == .user
                        ? Theme.Colors.accentSubtle
                        : Theme.Colors.groupedBackground
                )
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))

                if message.role == .assistant { Spacer() }
            }

            Text(DateFormatters.timeOnly.string(from: message.createdAt))
                .font(Theme.Typography.footnote)
                .foregroundStyle(Theme.Colors.quaternaryText)
        }
    }

    private func evidenceSection(_ evidence: [EvidenceReference]) -> some View {
        VStack(alignment: .leading, spacing: Theme.spacing4) {
            Divider()
            Text("Based on:")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Colors.tertiaryText)

            ForEach(evidence.indices, id: \.self) { index in
                HStack(spacing: Theme.spacing4) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 8))
                        .foregroundStyle(Theme.Colors.tertiaryText)
                    Text(evidence[index].description)
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Colors.secondaryText)
                }
            }
        }
    }
}
