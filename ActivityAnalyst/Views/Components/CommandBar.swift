import SwiftUI

/// Command bar / quick launcher for instant lookup, navigation, and AI queries.
/// Triggered by Cmd+K.
struct CommandBar: View {
    @Binding var isPresented: Bool
    @State private var query: String = ""
    @State private var selectedIndex: Int = 0

    var onNavigate: ((SidebarDestination) -> Void)?
    var onAIQuery: ((String) -> Void)?

    private var filteredDestinations: [SidebarDestination] {
        if query.isEmpty {
            return SidebarDestination.allCases
        }
        return SidebarDestination.allCases.filter {
            $0.displayName.localizedCaseInsensitiveContains(query)
        }
    }

    private var isAIQuery: Bool {
        query.count > 10 || query.contains("?") || query.lowercased().hasPrefix("how")
            || query.lowercased().hasPrefix("what") || query.lowercased().hasPrefix("which")
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Theme.spacing8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.Colors.secondaryText)

                TextField("Search or ask a question...", text: $query)
                    .textFieldStyle(.plain)
                    .font(Theme.Typography.title3)
                    .onSubmit {
                        handleSubmit()
                    }

                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Theme.Colors.tertiaryText)
                    }
                    .buttonStyle(.plain)
                }

                Text("esc")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Colors.tertiaryText)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 2)
                    .background(Theme.Colors.separator.opacity(0.3))
                    .clipShape(RoundedRectangle(cornerRadius: 3))
            }
            .padding(Theme.spacing16)

            Divider()

            if isAIQuery && !query.isEmpty {
                HStack(spacing: Theme.spacing8) {
                    Image(systemName: "brain.head.profile")
                        .foregroundStyle(Theme.Colors.accent)
                    Text("Ask AI: \"\(query)\"")
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.primaryText)
                    Spacer()
                    Text("return")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Colors.tertiaryText)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .background(Theme.Colors.separator.opacity(0.3))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                }
                .padding(Theme.spacing12)
                .background(Theme.Colors.accentSubtle)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if !isAIQuery {
                        Text("Navigate")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Colors.tertiaryText)
                            .padding(.horizontal, Theme.spacing12)
                            .padding(.vertical, Theme.spacing6)

                        ForEach(Array(filteredDestinations.enumerated()), id: \.element.id) { index, dest in
                            CommandBarItem(
                                destination: dest,
                                isSelected: index == selectedIndex
                            )
                            .contentShape(Rectangle())
                            .onTapGesture {
                                onNavigate?(dest)
                                isPresented = false
                            }
                        }
                    }
                }
            }
            .frame(maxHeight: 300)
        }
        .frame(width: 520)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLarge))
        .shadow(color: .black.opacity(0.2), radius: 20, y: 10)
        .onKeyPress(.escape) {
            isPresented = false
            return .handled
        }
        .onKeyPress(.downArrow) {
            selectedIndex = min(selectedIndex + 1, filteredDestinations.count - 1)
            return .handled
        }
        .onKeyPress(.upArrow) {
            selectedIndex = max(selectedIndex - 1, 0)
            return .handled
        }
    }

    private func handleSubmit() {
        if isAIQuery {
            onAIQuery?(query)
        } else if let dest = filteredDestinations[safe: selectedIndex] {
            onNavigate?(dest)
        }
        isPresented = false
    }
}

struct CommandBarItem: View {
    let destination: SidebarDestination
    let isSelected: Bool

    var body: some View {
        HStack(spacing: Theme.spacing8) {
            Image(systemName: destination.sfSymbol)
                .font(.system(size: 14))
                .foregroundStyle(isSelected ? Theme.Colors.accent : Theme.Colors.secondaryText)
                .frame(width: 20)

            Text(destination.displayName)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Colors.primaryText)

            Spacer()
        }
        .padding(.horizontal, Theme.spacing12)
        .padding(.vertical, Theme.spacing8)
        .background(isSelected ? Theme.Colors.accentSubtle : .clear)
    }
}

extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
