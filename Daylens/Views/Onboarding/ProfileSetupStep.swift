import SwiftUI

// MARK: - ProfileSetupStep

/// Standalone onboarding step that collects UserProfile fields.
/// Receives a binding to a UserProfile — wire into OnboardingFlow manually.
struct ProfileSetupStep: View {
    @Binding var profile: UserProfile
    var onContinue: () -> Void

    private let roles: [String] = [
        "Developer", "Designer", "Writer", "Manager",
        "Student", "Researcher", "Entrepreneur", "Other",
    ]

    private let goalOptions = [
        "Deep Focus", "Less Distraction", "Time Awareness",
        "Work-Life Balance", "Build Better Habits", "Ship More",
    ]

    private let distractionOptions = [
        "Social Media", "News Sites", "YouTube / Videos", "Email",
        "Slack / Chat", "Gaming", "Shopping", "Podcasts", "Other",
    ]

    private let idealDaySuggestions = [
        "Deep work in the morning, meetings in the afternoon, no late-night work",
        "Focused coding blocks with short breaks, clear shutdown time",
        "Creative work in the morning, admin in the afternoon",
    ]

    private var selectedRoles: [String] {
        profile.role
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private var selectedGoals: [String] {
        profile.goals
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private var selectedDistractions: [String] {
        (profile.biggestDistraction ?? "")
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
                items: roles,
                multiSelection: selectedRoles,
                maxSelect: roles.count,
                onMultiSelect: { label in
                    var current = selectedRoles
                    if current.contains(label) {
                        current.removeAll { $0 == label }
                    } else {
                        current.append(label)
                    }
                    profile.role = current.joined(separator: ", ")
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
                Text("Pick up to 3")
                    .font(.caption)
                    .foregroundStyle(DS.onSurfaceVariant)
            }
            ProfileChipGrid(
                items: goalOptions,
                multiSelection: selectedGoals,
                maxSelect: 3,
                onMultiSelect: { goal in
                    var goals = selectedGoals
                    if goals.contains(goal) {
                        goals.removeAll { $0 == goal }
                    } else if goals.count < 3 {
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

            VStack(alignment: .leading, spacing: DS.space4) {
                ForEach(idealDaySuggestions, id: \.self) { suggestion in
                    Button {
                        profile.idealDayDescription = suggestion
                    } label: {
                        HStack(spacing: DS.space6) {
                            Image(systemName: "lightbulb")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(DS.secondary)
                            Text("\u{201C}\(suggestion)\u{201D}")
                                .font(.caption)
                                .foregroundStyle(DS.onSurfaceVariant)
                                .multilineTextAlignment(.leading)
                        }
                        .padding(.horizontal, DS.space10)
                        .padding(.vertical, DS.space6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(DS.surfaceHighest, in: RoundedRectangle(cornerRadius: DS.radiusSmall))
                        .overlay(
                            RoundedRectangle(cornerRadius: DS.radiusSmall)
                                .stroke(DS.outlineVariant, lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var distractionSection: some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text("Biggest distraction")
                .font(.body.weight(.medium))
                .foregroundStyle(DS.onSurface)
            ProfileChipGrid(
                items: distractionOptions,
                multiSelection: selectedDistractions,
                maxSelect: distractionOptions.count,
                onMultiSelect: { option in
                    var current = selectedDistractions
                    if current.contains(option) {
                        current.removeAll { $0 == option }
                    } else {
                        current.append(option)
                    }
                    let joined = current.joined(separator: ", ")
                    profile.biggestDistraction = joined.isEmpty ? nil : joined
                }
            )
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
