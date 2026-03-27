import SwiftUI

// MARK: - ProfileEditSheet

struct ProfileEditSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var profile: UserProfile = ProfileEditSheet.defaultProfile()
    @State private var memories: [UserMemory] = []
    @State private var isLoading = true
    @State private var isSaving = false

    private static func defaultProfile() -> UserProfile {
        UserProfile(
            id: nil,
            name: "",
            role: "",
            goals: "",
            workHoursStart: 9,
            workHoursEnd: 18,
            idealDayDescription: "",
            biggestDistraction: nil,
            createdAt: Date(),
            updatedAt: Date()
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            sheetHeader
            Divider()
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: DS.space24) {
                        profileFields
                        memoryBankSection
                    }
                    .padding(DS.space24)
                }
            }
        }
        .frame(minWidth: 520, minHeight: 540)
        .background(DS.surfaceContainer)
        .task { await loadData() }
    }

    // MARK: - Header

    private var sheetHeader: some View {
        HStack {
            Text("Edit Profile")
                .font(.title3.weight(.semibold))
                .foregroundStyle(DS.onSurface)
            Spacer()
            Button("Cancel") { dismiss() }
                .buttonStyle(.borderless)
                .foregroundStyle(DS.onSurfaceVariant)
            Button {
                save()
            } label: {
                if isSaving {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Save")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSaving || profile.idealDayDescription.isEmpty)
        }
        .padding(.horizontal, DS.space24)
        .padding(.vertical, DS.space16)
    }

    // MARK: - Profile fields

    private let roleOptions: [String] = [
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

    private var selectedDistractions: [String] {
        (profile.biggestDistraction ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private var profileFields: some View {
        VStack(alignment: .leading, spacing: DS.space20) {
            sectionRow("Role") {
                ProfileChipGrid(
                    items: roleOptions,
                    multiSelection: selectedRoles,
                    maxSelect: roleOptions.count,
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

            sectionRow("Goals (up to 3)") {
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

            sectionRow("Work hours") {
                VStack(alignment: .leading, spacing: DS.space8) {
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

            sectionRow("Ideal productive day") {
                VStack(alignment: .leading, spacing: DS.space6) {
                    ProfileTextEditor(
                        text: $profile.idealDayDescription,
                        placeholder: "Deep focus in the morning, clear inbox by noon..."
                    )
                    .frame(minHeight: 60, maxHeight: 80)

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

            sectionRow("Biggest distraction") {
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
        .cardStyle()
    }

    @ViewBuilder
    private func sectionRow<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: DS.space8) {
            Text(label)
                .font(.body.weight(.medium))
                .foregroundStyle(DS.onSurface)
            content()
        }
    }

    // MARK: - Memory bank

    private var memoryBankSection: some View {
        VStack(alignment: .leading, spacing: DS.space12) {
            Text("Memory Bank")
                .sectionHeader()

            if memories.isEmpty {
                Text("No memories yet. Daylens learns from your AI conversations.")
                    .font(.callout)
                    .foregroundStyle(DS.onSurfaceVariant)
                    .padding(DS.space16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .cardStyle()
            } else {
                VStack(spacing: 0) {
                    ForEach(memories) { memory in
                        HStack(alignment: .top, spacing: DS.space12) {
                            VStack(alignment: .leading, spacing: DS.space4) {
                                Text(memory.fact)
                                    .font(.callout)
                                    .foregroundStyle(DS.onSurface)
                                HStack(spacing: DS.space4) {
                                    Image(systemName: "brain")
                                        .font(.caption2)
                                    Text(memory.source)
                                        .font(.caption)
                                }
                                .foregroundStyle(DS.onSurfaceVariant)
                            }
                            Spacer()
                            Button {
                                deleteMemory(memory)
                            } label: {
                                Image(systemName: "trash")
                                    .font(.system(size: 12))
                                    .foregroundStyle(DS.onSurfaceVariant)
                            }
                            .buttonStyle(.borderless)
                        }
                        .padding(.vertical, DS.space12)
                        .padding(.horizontal, DS.space16)

                        if memory.id != memories.last?.id {
                            Divider()
                                .padding(.horizontal, DS.space16)
                        }
                    }
                }
                .cardStyle()
            }
        }
    }

    // MARK: - Helpers

    private var selectedGoals: [String] {
        profile.goals
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private func hourLabel(_ hour: Int) -> String {
        let h = hour % 12 == 0 ? 12 : hour % 12
        return "\(h) \(hour < 12 ? "AM" : "PM")"
    }

    // MARK: - Data

    private func loadData() async {
        let db = appState.database!
        let (loadedProfile, loadedMemories): (UserProfile?, [UserMemory]) = await Task.detached {
            let p = try? db.fetchUserProfile()
            let m = (try? db.fetchRecentMemories(limit: 10)) ?? []
            return (p, m)
        }.value
        if let p = loadedProfile {
            profile = p
        } else {
            profile.name = appState.userName
        }
        memories = loadedMemories
        isLoading = false
    }

    private func save() {
        let db = appState.database!
        isSaving = true
        var profileToSave = profile
        profileToSave.updatedAt = Date()
        if profileToSave.name.isEmpty {
            profileToSave.name = appState.userName
        }
        Task.detached {
            try? db.saveUserProfile(profileToSave)
            await MainActor.run { dismiss() }
        }
    }

    private func deleteMemory(_ memory: UserMemory) {
        guard let id = memory.id else { return }
        let db = appState.database!
        Task.detached {
            try? db.deleteMemory(id: id)
        }
        memories.removeAll { $0.id == memory.id }
    }
}
