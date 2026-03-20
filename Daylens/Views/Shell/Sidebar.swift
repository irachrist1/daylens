import SwiftUI

/// Left navigation sidebar with tonal dark background.
struct Sidebar: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState

        VStack(alignment: .leading, spacing: 0) {
            // Gradient wordmark
            Text("Daylens")
                .font(.system(.title3, design: .default, weight: .bold))
                .foregroundStyle(DS.titleGradient)
                .padding(.horizontal, DS.space20)
                .padding(.top, DS.space28)
                .padding(.bottom, DS.space24)

            // Nav items
            VStack(spacing: DS.space2) {
                ForEach(SidebarSection.allCases) { section in
                    SidebarItem(
                        section: section,
                        isSelected: appState.selectedSection == section
                    ) {
                        appState.selectedSection = section
                    }
                }
            }
            .padding(.horizontal, DS.space12)

            Spacer()

            // Focus Session CTA
            FocusSidebarButton()
                .padding(.horizontal, DS.space12)
                .padding(.bottom, DS.space20)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(DS.surfaceLow)
    }
}

// MARK: - Sidebar Item

private struct SidebarItem: View {
    let section: SidebarSection
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 0) {
                // Left accent bar
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(isSelected ? DS.primary : Color.clear)
                    .frame(width: 3, height: 18)
                    .padding(.trailing, DS.space10)

                Image(systemName: section.icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(isSelected ? DS.primary : DS.onSurfaceVariant)
                    .frame(width: 18)

                Text(section.rawValue)
                    .font(.system(.subheadline, design: .default, weight: isSelected ? .medium : .regular))
                    .foregroundStyle(isSelected ? DS.onSurface : DS.onSurfaceVariant)
                    .padding(.leading, DS.space10)

                Spacer()
            }
            .frame(height: DS.sidebarItemHeight)
            .background(
                RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                    .fill(isSelected ? DS.surfaceHighest : (isHovered ? DS.surfaceHighest.opacity(0.5) : Color.clear))
            )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }
}

// MARK: - Focus Session Button

private struct FocusSidebarButton: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        if appState.focusSession.isRunning {
            HStack(spacing: DS.space8) {
                Circle()
                    .fill(DS.primary)
                    .frame(width: 6, height: 6)
                    .shadow(color: DS.primary.opacity(0.8), radius: 4)

                Text("Focus: \(appState.focusSession.formattedRemaining)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(DS.primary)

                Spacer()

                Button {
                    appState.focusSession.stop()
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(DS.onSurfaceVariant)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, DS.space12)
            .padding(.vertical, DS.space10)
            .background(
                DS.primary.opacity(0.1),
                in: RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
            )
        } else {
            Button {
                appState.focusSession.start(minutes: 25)
            } label: {
                HStack(spacing: DS.space8) {
                    Image(systemName: "timer")
                        .font(.system(size: 13, weight: .medium))
                    Text("Start Focus")
                        .font(.system(.subheadline, design: .default, weight: .medium))
                }
                .foregroundStyle(DS.onPrimaryFixed)
                .frame(maxWidth: .infinity)
                .padding(.vertical, DS.space10)
                .background(
                    DS.primaryContainer,
                    in: RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                )
            }
            .buttonStyle(.plain)
        }
    }
}
