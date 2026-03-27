import SwiftUI

/// A single work-context block rendered on the timeline.
struct TimelineBlock: View {
    let block: WorkContextBlock
    let hourHeight: CGFloat

    @State private var isHovered: Bool = false
    @State private var isPopoverPresented: Bool = false

    var blockHeight: CGFloat {
        max(4, CGFloat(Double(block.duration) / 3600.0) * hourHeight)
    }

    var body: some View {
        let accent = DS.categoryColor(for: block.dominantCategory)
        let isLowConfidence = block.confidence == .low

        ZStack(alignment: .topTrailing) {
            HStack(spacing: 0) {
                // Left color bar — dashed stroke overlay for low-confidence blocks
                ZStack {
                    Rectangle()
                        .fill(accent)
                        .frame(width: 3)
                    if isLowConfidence {
                        Rectangle()
                            .fill(DS.surfaceCard.opacity(0.5))
                            .frame(width: 3)
                            .mask(
                                VStack(spacing: 3) {
                                    ForEach(0..<50, id: \.self) { _ in
                                        Rectangle().frame(height: 3)
                                        Spacer()
                                    }
                                }
                            )
                    }
                }

                // Content — only shown when block is >= 5 minutes
                if block.duration >= 300 {
                    HStack(spacing: DS.space8) {
                        VStack(alignment: .leading, spacing: DS.space2) {
                            HStack(spacing: 3) {
                                if isLowConfidence {
                                    Text("~")
                                        .font(.system(size: block.duration < 900 ? 11 : 13, weight: .semibold))
                                        .foregroundStyle(DS.onSurfaceVariant)
                                }
                                Text(block.displayLabel)
                                    .font(.system(size: block.duration < 900 ? 11 : 13, weight: .semibold))
                                    .foregroundStyle(DS.onSurface)
                                    .lineLimit(1)
                            }
                            if block.duration >= 900 {
                                Text(formattedDuration)
                                    .font(.system(size: 12, weight: .regular))
                                    .foregroundStyle(DS.onSurfaceVariant)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        if block.duration >= 900 {
                            HStack(spacing: DS.space4) {
                                ForEach(block.topApps.prefix(3), id: \.bundleID) { app in
                                    AppIconView(bundleID: app.bundleID, size: 20)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, DS.space8)
                    .padding(.vertical, DS.space6)
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .background(accent.opacity(isHovered ? 0.14 : 0.08))
            .clipShape(RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                    .strokeBorder(accent.opacity(isHovered ? 0.30 : 0.18), lineWidth: isHovered ? 1 : 0.5)
            )
            .scaleEffect(isHovered ? 1.01 : 1.0, anchor: .center)
            .animation(.easeOut(duration: 0.12), value: isHovered)
            .padding(.vertical, 2)

            // Live indicator
            if block.isLive {
                Circle()
                    .fill(accent)
                    .frame(width: 7, height: 7)
                    .padding([.top, .trailing], DS.space6)
            }
        }
        .onTapGesture { isPopoverPresented.toggle() }
        .contextMenu {
            Button {
                NSPasteboard.general.setString(block.displayLabel, forType: .string)
            } label: {
                Label("Copy Label", systemImage: "doc.on.doc")
            }
            Button {
                isPopoverPresented = true
            } label: {
                Label("View Sessions", systemImage: "list.bullet")
            }
            if let firstApp = block.topApps.first {
                Divider()
                Button {} label: {
                    Label("Change Category for \(firstApp.appName)", systemImage: "tag")
                }
            }
        }
        .onHover { isHovered = $0 }
        .help("Click to see session details")
        .popover(isPresented: $isPopoverPresented, arrowEdge: .trailing) {
            BlockDetailPopover(block: block)
                .background(DS.surfaceCard)
        }
    }

    private var formattedDuration: String {
        let total = Int(block.duration)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        if hours > 0 && minutes > 0 { return "\(hours)h \(minutes)m" }
        if hours > 0 { return "\(hours)h" }
        if minutes > 0 { return "\(minutes)m" }
        let seconds = total % 60
        return "\(seconds)s"
    }
}
