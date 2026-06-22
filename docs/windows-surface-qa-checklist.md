# Windows surface QA checklist (DEV-95)

Run on a **physical Windows machine** after capture packets land. Attach screenshots to [DEV-95](https://linear.app/irachrist1/issue/DEV-95).

## Capture

- [ ] Foreground app + window title appear in Timeline within 30s of switching apps
- [ ] Edge/Chrome tab URL appears in Apps without waiting for history lag (UIA helper)
- [ ] Zen/Firefox pages appear via history polling; live tab shows honest unknown (never guessed)
- [ ] Capture health in Settings shows **Healthy** window titles when browsing
- [ ] Capture health lists discovered browsers

## Timeline (`docs/specs/timeline.md`)

- [ ] Analyze Day yields ~8 believable blocks on a real day
- [ ] Block height proportional to duration
- [ ] Rename survives re-analyze
- [ ] Brief detour absorbed into surrounding block

## Apps (`docs/specs/apps.md`)

- [ ] App names are real (not raw exe noise)
- [ ] Domains attributed to hosting browser
- [ ] Delete page/domain works

## AI (`docs/specs/ai.md`)

- [ ] "What did I do today?" returns grounded answer
- [ ] Chat survives tab switch
- [ ] Model from Settings is the one that runs

## Settings (`docs/specs/settings.md`)

- [ ] Work memory paragraph edits persist
- [ ] Label overrides propagate after recompute
- [ ] Exclusions hide data from AI

## Onboarding (`docs/specs/onboarding.md`)

- [ ] Proof step shows real captured activity (not canned)

## Wraps (`docs/specs/briefs-wraps.md`)

- [ ] When DEV-91 lands: card and write-up totals agree

## Background evidence (Windows advantage)

- [ ] Long `npm run build` while switched away appears in block evidence

## Install

- [ ] NSIS installer on clean VM per `docs/INSTALL.md`
