import SwiftUI

struct CompletionStep: View {
    let onComplete: () -> Void

    var body: some View {
        VStack(spacing: DS.space24) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.green)

            VStack(spacing: DS.space8) {
                Text("You're All Set")
                    .font(.largeTitle.weight(.bold))

                Text("Daylens is now tracking your activity.\nJust use your Mac normally — we'll handle the rest.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            VStack(alignment: .leading, spacing: DS.space8) {
                tipRow("Check the Today tab for your daily overview")
                tipRow("Your activity data builds up over the first few minutes")
                tipRow("Use the Insights tab to ask AI about your day")
                tipRow("All data is stored locally on your Mac")
            }
            .padding(.horizontal, DS.space32)

            Spacer()

            Button("Start Using Daylens") {
                onComplete()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.bottom, DS.space32)
        }
        .padding(DS.space24)
    }

    private func tipRow(_ text: String) -> some View {
        HStack(spacing: DS.space8) {
            Image(systemName: "arrow.right")
                .font(.caption)
                .foregroundStyle(.accent)
            Text(text)
                .font(.body)
                .foregroundStyle(.secondary)
        }
    }
}
