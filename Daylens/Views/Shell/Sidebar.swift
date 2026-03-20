import SwiftUI

/// Left navigation sidebar with tonal dark background.
struct Sidebar: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState

        VStack(alignment: .leading, spacing: 0) {
            // App title
            Text("Daylens")
                .font(.system(.title3, design: .default, weight: .semibold))
                .foregroundStyle(DS.onSurface)
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
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(DS.surfaceLow)
    }
}

private struct SidebarItem: View {
    let section: SidebarSection
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: DS.space10) {
                Image(systemName: section.icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(isSelected ? DS.primary : DS.onSurfaceVariant)
                    .frame(width: 18)

                Text(section.rawValue)
                    .font(.system(.subheadline, design: .default, weight: isSelected ? .medium : .regular))
                    .foregroundStyle(isSelected ? DS.onSurface : DS.onSurfaceVariant)

                Spacer()
            }
            .padding(.horizontal, DS.space12)
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
