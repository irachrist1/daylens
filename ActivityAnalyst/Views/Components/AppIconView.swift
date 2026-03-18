import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

/// Displays the actual macOS app icon for a given bundle identifier.
/// Falls back to the category SF Symbol if the app icon cannot be loaded.
struct AppIconView: View {
    let bundleIdentifier: String
    let category: ActivityCategory
    let size: CGFloat

    init(bundleIdentifier: String, category: ActivityCategory = .uncategorized, size: CGFloat = 32) {
        self.bundleIdentifier = bundleIdentifier
        self.category = category
        self.size = size
    }

    var body: some View {
        Group {
            #if canImport(AppKit)
            if let nsImage = loadAppIcon() {
                Image(nsImage: nsImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: size, height: size)
            } else {
                fallbackIcon
            }
            #else
            fallbackIcon
            #endif
        }
    }

    private var fallbackIcon: some View {
        Image(systemName: category.sfSymbol)
            .font(.system(size: size * 0.5))
            .foregroundStyle(Theme.Colors.category(category))
            .frame(width: size, height: size)
            .background(Theme.Colors.category(category).opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: size * 0.2))
    }

    #if canImport(AppKit)
    private func loadAppIcon() -> NSImage? {
        guard let appURL = NSWorkspace.shared.urlForApplication(
            withBundleIdentifier: bundleIdentifier
        ) else {
            return nil
        }
        return NSWorkspace.shared.icon(forFile: appURL.path)
    }
    #endif
}
