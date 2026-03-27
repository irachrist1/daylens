import SwiftUI

// MARK: - ProfileSetupStep

/// Standalone onboarding step that collects UserProfile fields.
/// Receives a binding to a UserProfile — wire into OnboardingFlow manually.
struct ProfileSetupStep: View {
    @Binding var profile: UserProfile
    var onContinue: () -> Void

    private let roles: [(label: String, value: String)] = [
        ("Developer", "developer"),
        ("Designer", "designer"),
        ("Writer", "writer"),
        ("Manager", "manager"),
        ("Student", "student"),
        ("Other", "other"),
    ]

    private let goalOptions = [
        "Deep Focus",
        "Less Distraction",
        "Time Awareness",
        "Work-Life Balance",
    ]

    private var selectedGoals: [String] {
        profile.goals
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.space24) {
                    header
                    roleSection
                    goalsSection
                    workHoursSection
                    idealDaySection
                    distractionSection
                }
                .padding(.horizontal, DS.space40)
                .padding(.vertical, DS.space24)
            }

            Button("Continue", action: onContinue)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!canContinue)
                .padding(.bottom, DS.space32)
        }
    }

    private var canContinue: Bool {
        !profile.role.isEmpty && !profile.idealDayDescription.isEmpty
    }

    // MARK: Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text("Personalize Daylens")
                .font(.title2.weight(.semibold))
                .foregroundStyle(DS.onSurface)
            Text("Help us understand how you work best.")
                .font(.body)
                .foregroundStyle(.secondary)
                .lineSpacing(3)
        }
    }

    private var roleSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("I am a")
                .font(.body.weight(.medium))
                .foregroundStyle(DS.onSurface)
            ProfileChipGrid(
                items: roles.map(\.label),
                selection: roles.first(where: { $0.value == profile.role })?.label ?? "",
                onSelect: { label in
                    profile.role = roles.first(where: { $0.label == label })?.value ?? label.lowercased()
                }
            )
        }
    }

    private var goalsSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            VStack(alignment: .leading, spacing: DS.space4) {
                Text("My main goals")
                    .font(.body.weight(.medium))
                    .foregroundStyle(DS.onSurface)
                Text("Pick up to 2")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant)
            }
            ProfileChipGrid(
                items: goalOptions,
                multiSelection: selectedGoals,
                maxSelect: 2,
                onMultiSelect: { goal in
                    var goals = selectedGoals
                    if goals.contains(goal) {
                        goals.removeAll { $0 == goal }
                    } else if goals.count < 2 {
                        goals.append(goal)
                    }
                    profile.goals = goals.joined(separator: ", ")
                }
            )
        }
    }

    private var workHoursSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Work hours")
                .font(.body.weight(.medium))
                .foregroundStyle(DS.onSurface)
            Text("I work from \(hourLabel(profile.workHoursStart)) to \(hourLabel(profile.workHoursEnd))")
                .font(.callout.weight(.medium))
                .foregroundStyle(DS.primary)
            HStack(spacing: DS.space24) {
                ProfileLabeledStepper(
                    label: "Start",
                    value: $profile.workHoursStart,
                    range: 0...23,
                    format: hourLabel
                )
                ProfileLabeledStepper(
                    label: "End",
                    value: $profile.workHoursEnd,
                    range: 0...23,
                    format: hourLabel
                )
            }
        }
    }

    private var idealDaySection: some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text("What does a great productive day look like for you?")
                .font(.body.weight(.medium))
                .foregroundStyle(DS.onSurface)
            ProfileTextEditor(
                text: $profile.idealDayDescription,
                placeholder: "Deep focus in the morning, clear inbox by noon..."
            )
            .frame(minHeight: 64, maxHeight: 80)
        }
    }

    private var distractionSection: some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text("Biggest distraction")
                .font(.body.weight(.medium))
                .foregroundStyle(DS.onSurface)
            TextField(
                "Social media, news sites, Slack... (optional)",
                text: Binding(
                    get: { profile.biggestDistraction ?? "" },
                    set: { profile.biggestDistraction = $0.isEmpty ? nil : $0 }
                )
            )
            .textFieldStyle(.roundedBorder)
        }
    }

    private func hourLabel(_ hour: Int) -> String {
        let h = hour % 12 == 0 ? 12 : hour % 12
        return "\(h) \(hour < 12 ? "AM" : "PM")"
    }
}

// MARK: - Shared Profile UI Components
// These are internal so they can be reused by ProfileEditSheet.

struct ProfileChipGrid: View {
    let items: [String]
    var selection: String = ""
    var multiSelection: [String] = []
    var maxSelect: Int = 1
    var onSelect: ((String) -> Void)?
    var onMultiSelect: ((String) -> Void)?

    /// Single-select initializer
    init(items: [String], selection: String, onSelect: @escaping (String) -> Void) {
        self.items = items
        self.selection = selection
        self.maxSelect = 1
        self.onSelect = onSelect
    }

    /// Multi-select initializer
    init(items: [String], multiSelection: [String], maxSelect: Int, onMultiSelect: @escaping (String) -> Void) {
        self.items = items
        self.multiSelection = multiSelection
        self.maxSelect = maxSelect
        self.onMultiSelect = onMultiSelect
    }

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 110, maximum: 170), spacing: DS.space8)],
            spacing: DS.space8
        ) {
            ForEach(items, id: \.self) { item in
                let isSelected = maxSelect == 1
                    ? item == selection
                    : multiSelection.contains(item)
                Button {
                    if maxSelect == 1 {
                        onSelect?(item)
                    } else {
                        onMultiSelect?(item)
                    }
                } label: {
                    Text(item)
                        .font(.callout.weight(isSelected ? .medium : .regular))
                        .foregroundStyle(isSelected ? DS.primary : DS.onSurfaceVariant)
                        .padding(.horizontal, DS.space12)
                        .padding(.vertical, DS.space8)
                        .frame(maxWidth: .infinity)
                        .background(
                            RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                                .fill(isSelected ? DS.primaryContainer.opacity(0.4) : DS.surfaceHighest)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                                .stroke(
                                    isSelected ? DS.primary : DS.outlineVariant,
                                    lineWidth: isSelected ? 1.5 : 1
                                )
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct ProfileLabeledStepper: View {
    let label: String
    @Binding var value: Int
    let range: ClosedRange<Int>
    let format: (Int) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: DS.space4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(DS.onSurfaceVariant)
            HStack(spacing: DS.space8) {
                Text(format(value))
                    .font(.body.weight(.medium))
                    .foregroundStyle(DS.onSurface)
                    .frame(minWidth: 56, alignment: .leading)
                Stepper("", value: $value, in: range)
                    .labelsHidden()
            }
        }
    }
}

struct ProfileTextEditor: View {
    @Binding var text: String
    let placeholder: String

    var body: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $text)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(DS.space8)
                .background(DS.surfaceHighest, in: RoundedRectangle(cornerRadius: DS.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: DS.radiusMedium, style: .continuous)
                        .stroke(DS.outlineVariant, lineWidth: 1)
                )
            if text.isEmpty {
                Text(placeholder)
                    .font(.body)
                    .foregroundStyle(DS.onSurfaceVariant.opacity(0.5))
                    .padding(.top, DS.space8 + 5)
                    .padding(.leading, DS.space8 + 4)
                    .allowsHitTesting(false)
            }
        }
    }
}
