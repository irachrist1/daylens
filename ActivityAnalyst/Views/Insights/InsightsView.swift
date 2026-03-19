import SwiftUI

/// Insights page: full-screen conversational AI chatbot.
/// Ask questions about your activity and get responses with inline data widgets.
struct InsightsView: View {
    @StateObject private var aiVM = AIConversationViewModel()
    @ObservedObject private var services = ServiceContainer.shared

    var body: some View {
        VStack(spacing: 0) {
            if aiVM.messages.isEmpty {
                welcomeScreen
            } else {
                chatMessages
            }

            Divider()

            chatInput
        }
        .background(Theme.Colors.background)
    }

    // MARK: - Welcome Screen (shown when no messages)

    private var welcomeScreen: some View {
        ScrollView {
            VStack(spacing: Theme.spacing32) {
                Spacer(minLength: 40)

                VStack(spacing: Theme.spacing12) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 44, weight: .thin))
                        .foregroundStyle(Theme.Colors.accent)

                    Text("Ask me anything")
                        .font(Theme.Typography.largeTitle)
                        .foregroundStyle(Theme.Colors.primaryText)

                    Text("I can analyze your activity, find patterns, and give you insights about how you spend your time.")
                        .font(Theme.Typography.callout)
                        .foregroundStyle(Theme.Colors.secondaryText)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 400)
                }

                if !services.hasAI {
                    HStack(spacing: Theme.spacing8) {
                        Image(systemName: "key.fill")
                            .foregroundStyle(.orange)
                        Text("Add your Anthropic API key in Settings to get started.")
                            .font(Theme.Typography.callout)
                            .foregroundStyle(Theme.Colors.secondaryText)
                    }
                    .padding(Theme.spacing12)
                    .background(Color.orange.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
                }

                VStack(spacing: Theme.spacing8) {
                    Text("Try asking")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Colors.tertiaryText)
                        .textCase(.uppercase)

                    LazyVGrid(columns: [
                        GridItem(.flexible()),
                        GridItem(.flexible())
                    ], spacing: Theme.spacing8) {
                        SuggestionChip(text: "Where do I spend most of my time?") {
                            submitSuggestion("Where do I spend most of my time?")
                        }
                        SuggestionChip(text: "What was my most productive hour today?") {
                            submitSuggestion("What was my most productive hour today?")
                        }
                        SuggestionChip(text: "Am I spending too much time on social media?") {
                            submitSuggestion("Am I spending too much time on social media?")
                        }
                        SuggestionChip(text: "Which apps did I use the most this week?") {
                            submitSuggestion("Which apps did I use the most this week?")
                        }
                        SuggestionChip(text: "How focused was I today?") {
                            submitSuggestion("How focused was I today?")
                        }
                        SuggestionChip(text: "Give me a summary of my day") {
                            submitSuggestion("Give me a summary of my day")
                        }
                    }
                    .frame(maxWidth: 600)
                }

                Spacer(minLength: 40)
            }
            .padding(Theme.spacing24)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Chat Messages

    private var chatMessages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Theme.spacing16) {
                    ForEach(aiVM.messages) { message in
                        ChatBubble(message: message)
                            .id(message.id)
                    }

                    if aiVM.isProcessing {
                        HStack(spacing: Theme.spacing8) {
                            ProgressView()
                                .scaleEffect(0.7)
                            Text("Analyzing your activity data...")
                                .font(Theme.Typography.callout)
                                .foregroundStyle(Theme.Colors.tertiaryText)
                        }
                        .padding(Theme.spacing12)
                        .id("thinking")
                    }
                }
                .padding(Theme.spacing24)
            }
            .onChange(of: aiVM.messages.count) { _, _ in
                withAnimation {
                    if let lastId = aiVM.messages.last?.id {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
            .onChange(of: aiVM.isProcessing) { _, processing in
                if processing {
                    withAnimation { proxy.scrollTo("thinking", anchor: .bottom) }
                }
            }
        }
    }

    // MARK: - Chat Input

    private var chatInput: some View {
        HStack(spacing: Theme.spacing12) {
            Button {
                aiVM.startNewConversation()
            } label: {
                Image(systemName: "plus.circle")
                    .font(.system(size: 20))
                    .foregroundStyle(Theme.Colors.tertiaryText)
            }
            .buttonStyle(.plain)
            .help("New conversation")

            TextField("Ask about your activity...", text: $aiVM.inputText, axis: .vertical)
                .textFieldStyle(.plain)
                .font(Theme.Typography.body)
                .lineLimit(1...4)
                .onSubmit { aiVM.sendMessage() }

            Button {
                aiVM.sendMessage()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(
                        aiVM.inputText.isEmpty || !services.hasAI
                            ? Theme.Colors.tertiaryText
                            : Theme.Colors.accent
                    )
            }
            .buttonStyle(.plain)
            .disabled(aiVM.inputText.isEmpty || aiVM.isProcessing || !services.hasAI)
        }
        .padding(.horizontal, Theme.spacing16)
        .padding(.vertical, Theme.spacing12)
    }

    private func submitSuggestion(_ text: String) {
        aiVM.inputText = text
        aiVM.sendMessage()
    }
}

// MARK: - Suggestion Chip

struct SuggestionChip: View {
    let text: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Colors.accent)
                .padding(.horizontal, Theme.spacing12)
                .padding(.vertical, Theme.spacing8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.Colors.accentSubtle)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Chat Bubble

struct ChatBubble: View {
    let message: AIMessage

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: Theme.spacing4) {
            HStack {
                if message.role == .user { Spacer(minLength: 80) }

                VStack(alignment: .leading, spacing: Theme.spacing8) {
                    if message.role == .assistant {
                        HStack(spacing: Theme.spacing6) {
                            Image(systemName: "brain.head.profile")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.Colors.accent)
                            Text("DayLens AI")
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Colors.tertiaryText)
                        }
                    }

                    Text(message.content)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.primaryText)
                        .lineSpacing(3)
                        .textSelection(.enabled)

                    if let evidence = message.evidence, !evidence.isEmpty {
                        VStack(alignment: .leading, spacing: Theme.spacing4) {
                            Divider()
                            HStack(spacing: Theme.spacing4) {
                                Image(systemName: "chart.bar.doc.horizontal")
                                    .font(.system(size: 10))
                                    .foregroundStyle(Theme.Colors.tertiaryText)
                                Text("Based on your data")
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(Theme.Colors.tertiaryText)
                            }

                            ForEach(evidence.indices, id: \.self) { idx in
                                Text("· \(evidence[idx].description)")
                                    .font(Theme.Typography.footnote)
                                    .foregroundStyle(Theme.Colors.secondaryText)
                            }
                        }
                    }
                }
                .padding(Theme.spacing12)
                .background(
                    message.role == .user
                        ? Theme.Colors.accentSubtle
                        : Theme.Colors.groupedBackground
                )
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMedium))

                if message.role == .assistant { Spacer(minLength: 80) }
            }

            Text(DateFormatters.timeOnly.string(from: message.createdAt))
                .font(.system(size: 10))
                .foregroundStyle(Theme.Colors.quaternaryText)
        }
    }
}
