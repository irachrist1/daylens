import SwiftUI

/// A horizontal ranked bar used for top apps / sites / browsers lists.
/// Shows rank number, icon/label, a proportional fill bar, and duration.
struct RankedBarView: View {
    let rank: Int
    let label: String
    let sublabel: String?
    let seconds: Double
    let maxSeconds: Double
    let icon: Image?
    let color: Color
    var onTap: (() -> Void)?

    private var fraction: Double {
        guard maxSeconds > 0 else { return 0 }
        return min(1, seconds / maxSeconds)
    }

    var body: some View {
        Button(action: { onTap?() }) {
            HStack(spacing: 10) {
                // Rank number
                Text("\(rank)")
                    .font(DLTypography.label)
                    .foregroundColor(.secondary)
                    .frame(width: 16, alignment: .trailing)

                // Icon or placeholder
                Group {
                    if let icon {
                        icon
                            .resizable()
                            .scaledToFit()
                            .frame(width: 18, height: 18)
                    } else {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(color.opacity(0.3))
                            .frame(width: 18, height: 18)
                    }
                }

                // Label stack
                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(DLTypography.bodyMedium)
                        .lineLimit(1)
                    if let sub = sublabel {
                        Text(sub)
                            .font(DLTypography.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer(minLength: 8)

                // Bar + duration
                HStack(spacing: 6) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(Color.secondary.opacity(0.12))
                                .frame(height: 6)
                            RoundedRectangle(cornerRadius: 2)
                                .fill(color)
                                .frame(width: geo.size.width * fraction, height: 6)
                        }
                    }
                    .frame(width: 80, height: 6)

                    Text(seconds.durationString)
                        .font(DLTypography.label)
                        .foregroundColor(.secondary)
                        .frame(width: 44, alignment: .trailing)
                }
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
