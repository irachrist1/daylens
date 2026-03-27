import SwiftUI

struct UsageMetricModePicker: View {
    @Binding var selection: UsageMetricMode
    var width: CGFloat? = 220

    var body: some View {
        Picker("", selection: $selection) {
            ForEach(UsageMetricMode.allCases) { mode in
                Text(mode.title).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(width: width)
        .help(selection.subtitle)
    }
}
