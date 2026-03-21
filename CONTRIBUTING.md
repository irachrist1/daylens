# Contributing to Daylens

Thanks for helping improve Daylens.

## Before You Change Code

- Read `CLAUDE.md` in full before making any code change. It contains critical safety rules derived from real data-loss incidents.
- `AGENTS.md` and `CLAUDE.md` are gitignored on purpose and must never be committed.
- Do not touch onboarding persistence in `AppState.swift`, `DaylensApp.swift`, or onboarding-related defaults keys.
- Never add `eraseDatabaseOnSchemaChange = true`.
- Never run `sqlite3` against the live Daylens database while the app is open.

## Local Build

1. Install dependencies:
   - Xcode 15+
   - [XcodeGen](https://github.com/yonaskolb/XcodeGen)
2. Generate the project:

   ```bash
   xcodegen generate
   ```

3. Open the project in Xcode:

   ```bash
   open Daylens.xcodeproj
   ```

4. Select the `Daylens` scheme and build/run from Xcode.

## Branch Naming

Use descriptive branches. The preferred format is one of:

- `feature/<short-description>`
- `fix/<short-description>`
- `chore/<short-description>`
- `codex/<short-description>`

## Pull Request Process

1. Keep PRs focused and easy to review.
2. Regenerate the project with `xcodegen generate` if configuration changes require it.
3. Run the relevant tests before opening the PR.
4. Use the pull request template checklist.
5. Request Greptile review by tagging `@greptile-apps review` in the PR body.
6. Fix all findings before requesting the second and final Greptile round.

## Greptile Review Rule

Greptile is limited to two bot review rounds per PR.

- First round: tag `@greptile-apps review`
- Fix everything
- Second round: tag `@greptile-apps review` again
- Do not tag a third time on the same PR

If more work is needed after two rounds, fix the issues and open a fresh PR.

## Reporting Changes

- Include screenshots or short recordings for UI changes when possible
- Call out any migration, permissions, or release-engineering impact clearly
- Note any manual QA you performed

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
