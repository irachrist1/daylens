import SwiftUI

struct ChatView: View {
    @Environment(\.appEnvironment) private var env
    @State private var messages: [ConversationMessage] = []
    @State private var inputText = ""
    @State private var isThinking = false
    @State private var streamingResponse = ""
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Messages list
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        if messages.isEmpty {
                            suggestedQuestions
                        }

                        ForEach(messages) { message in
                            ChatBubble(message: message)
                                .id(message.id)
                        }

                        if isThinking && !streamingResponse.isEmpty {
                            ChatBubble(message: ConversationMessage(
                                role: .assistant,
                                content: streamingResponse + " ▋"
                            ))
                            .id("streaming")
                        }

                        if isThinking && streamingResponse.isEmpty {
                            HStack(spacing: 6) {
                                ProgressView().scaleEffect(0.7)
                                Text("Thinking…")
                                    .font(DLTypography.caption)
                                    .foregroundColor(.secondary)
                            }
                            .id("thinking")
                        }
                    }
                    .padding(20)
                }
                .onChange(of: messages.count) { _, _ in
                    withAnimation { proxy.scrollTo(messages.last?.id, anchor: .bottom) }
                }
                .onChange(of: streamingResponse) { _, _ in
                    withAnimation { proxy.scrollTo("streaming", anchor: .bottom) }
                }
            }

            Divider()

            // Input bar
            HStack(spacing: 10) {
                TextField("Ask about your activity…", text: $inputText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(DLTypography.bodyMedium)
                    .lineLimit(1...4)
                    .focused($isInputFocused)
                    .onSubmit { sendMessage() }

                Button {
                    sendMessage()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(inputText.isEmpty ? .secondary : Color.dlAccent)
                }
                .buttonStyle(.plain)
                .disabled(inputText.isEmpty || isThinking)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color(NSColor.controlBackgroundColor))
        }
        .navigationTitle("Chat")
        .onAppear { isInputFocused = true }
    }

    // MARK: - Suggested questions

    private var suggestedQuestions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ask anything about your activity")
                .font(DLTypography.headingSmall)
                .padding(.bottom, 4)

            let suggestions = [
                "How much time did I spend on YouTube today?",
                "What was my most fragmented hour this week?",
                "Which browser did I use the most?",
                "What apps consumed the most focus time?"
            ]

            ForEach(suggestions, id: \.self) { suggestion in
                Button {
                    inputText = suggestion
                    sendMessage()
                } label: {
                    HStack {
                        Image(systemName: "bubble.left")
                            .font(.system(size: 11))
                            .foregroundColor(Color.dlAccent)
                        Text(suggestion)
                            .font(DLTypography.bodyMedium)
                            .multilineTextAlignment(.leading)
                        Spacer()
                    }
                    .padding(10)
                    .background(Color.dlAccent.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Sending

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isThinking else { return }

        inputText = ""
        let userMsg = ConversationMessage(role: .user, content: text)
        messages.append(userMsg)
        isThinking = true
        streamingResponse = ""

        Task {
            do {
                for try await chunk in env.analyst.streamAnswer(to: text, priorMessages: messages) {
                    await MainActor.run {
                        streamingResponse += chunk
                    }
                }
                await MainActor.run {
                    let aiMsg = ConversationMessage(role: .assistant, content: streamingResponse)
                    messages.append(aiMsg)
                    streamingResponse = ""
                    isThinking = false
                }
            } catch {
                await MainActor.run {
                    let errMsg = ConversationMessage(
                        role: .assistant,
                        content: "I couldn't retrieve an answer right now. Please check your API key in Settings."
                    )
                    messages.append(errMsg)
                    streamingResponse = ""
                    isThinking = false
                }
            }
        }
    }
}

struct ChatBubble: View {
    let message: ConversationMessage

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.role == .assistant {
                Image(systemName: "sparkles")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.dlAccent)
                    .frame(width: 20, height: 20)
                    .background(Color.dlAccent.opacity(0.1), in: Circle())
            }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                Text(message.content)
                    .font(DLTypography.bodyMedium)
                    .padding(10)
                    .background(
                        message.role == .user
                            ? Color.dlAccent.opacity(0.12)
                            : Color(NSColor.controlBackgroundColor),
                        in: RoundedRectangle(cornerRadius: 10)
                    )
                    .frame(maxWidth: 500, alignment: message.role == .user ? .trailing : .leading)

                Text(message.date, style: .time)
                    .font(DLTypography.caption)
                    .foregroundColor(.secondary)
            }

            if message.role == .user { Spacer() }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }
}
