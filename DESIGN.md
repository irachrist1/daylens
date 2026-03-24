# Daylens Design System — Intelligent Monolith

Daylens follows the **Intelligent Monolith** design language: an editorial, heads-down aesthetic that blends the spatial depth of Arc, the precision of Linear, and the data-centricity of Rize. The UI is never a dashboard you have to interpret — it is a series of luminous strata that guide the eye toward what matters.

---

## Philosophy

- **Show meaning before detail.** Every screen answers a question before it presents a table.
- **Intelligence is invisible.** Algorithmic insight precedes raw numbers. Insights are computed from real data; if data is insufficient, the insight is hidden.
- **One answer per view.** Each view's primary finding is displayed bold, clear, and large at the top. More detail is one scroll away, never forced.
- **No visual noise.** Micro-sessions, repeated switches, and low-signal fragments are grouped or filtered unless the user explicitly requests raw history.
- **Action is always obvious.** Every important insight points toward a next step.

---

## Color Tokens

All surface colors are CSS variables defined in `src/renderer/styles/globals.css`. The dark/light values swap automatically via `[data-theme="light"]`. Never hardcode surface hex values in components — always use the variable.

| Token | Dark | Light | Usage |
|---|---|---|---|
| `--color-bg` | `#0b0e14` | `#f0f0f0` | Global page background |
| `--color-surface` | `#10131a` | `#f8f8f8` | Base layer |
| `--color-surface-low` | `#191c22` | `#f0f0f0` | Secondary cards |
| `--color-surface-container` | `#1d2026` | `#ffffff` | Primary card background |
| `--color-surface-high` | `#272a32` | `#e8e8e8` | Interactive hover, tracks |
| `--color-surface-highest` | `#32353c` | `#dde0e8` | Elevated elements |
| `--color-primary` | `#adc6ff` | `#1a56db` | Accent, focus ring, links |
| `--color-secondary` | `#ffb95f` | `#e08a00` | Meetings, secondary data |
| `--color-tertiary` | `#4fdbc8` | `#0d7a6c` | Communication, streak |
| `--color-text-primary` | `#e1e2eb` | `rgba(0,0,0,0.87)` | Headings, values |
| `--color-text-secondary` | `#c2c6d6` | `rgba(0,0,0,0.60)` | Body, labels |
| `--color-text-tertiary` | `#8c909f` | `rgba(0,0,0,0.38)` | Metadata, disabled |

**Hardcoded data colors** (intentionally fixed — not surface colors, do not replace):

```
development:   #adc6ff    meetings:      #ffb95f
communication: #4fdbc8    browsing:      #94a3b8
entertainment: #f87171    writing:       #c084fc
aitools:       #34d399    design:        #e879f9
research:      #67e8f9    email:         #fbbf24
productivity:  #a3e635    social:        #fb923c
system/other:  #6b7280
```

---

## Typography

**Font:** Inter (loaded via system or bundled). All weights 100–900.

| Role | Size | Weight | Letter-spacing | Transform |
|---|---|---|---|---|
| Page title | 36px | 900 | -0.03em | — |
| Card heading | 20–24px | 900 | -0.02em | — |
| Section label | 10px | 900 | 0.20em | uppercase |
| Stat label | 10px | 900 | 0.15em | uppercase |
| Stat value | 18–52px | 900 | -0.02em | — |
| Body / sublabel | 13px | 400–500 | — | — |
| Category chip | 10px | 700 | 0.10em | uppercase |
| Nav items | 12px | 700 | 0.08em | uppercase |

---

## Surface Hierarchy — The No-Line Rule

**Do not use 1px solid borders to define sections.** Define workspaces through background color shifts instead.

- Global backdrop: `var(--color-bg)` (`#0b0e14`)
- Active work area / cards: `var(--color-surface-container)` (`#1d2026`)
- Nested inner modules: `var(--color-surface-high)` (`#272a32`)
- Ghost border (only when separation is functionally required): `rgba(66,71,84,0.15)` — never fully opaque

---

## Component Patterns

### Cards
```
background: var(--color-surface-container)
borderRadius: 16
padding: 28–32px
```
Nested inner cards step up one tier: `var(--color-surface-high)` inside a `var(--color-surface-container)` card.

### Section Labels
```
fontSize: 10, fontWeight: 900, textTransform: uppercase
letterSpacing: 0.2em, color: var(--color-text-secondary)
```
Often paired with a horizontal divider line to the right:
```jsx
<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
  <span>Section Name</span>
  <div style={{ flex: 1, height: 1, background: 'rgba(66,71,84,0.20)' }} />
</div>
```

### Category / Status Chips
```
background: ${color}1a   (color at 10% opacity)
color: ${color}
fontSize: 10, fontWeight: 700
textTransform: uppercase, letterSpacing: 0.10em
padding: 2px 8px, borderRadius: 999
```

### Buttons

**Primary (gradient):**
```
background: linear-gradient(135deg, #adc6ff, #4d8eff)
color: #001a42
fontWeight: 900, borderRadius: 8–12
```

**Secondary (outline):**
```
background: transparent
border: 1px solid rgba(173,198,255,0.20)
color: var(--color-primary)
```

**Danger:**
```
color: #f87171
background: rgba(248,113,113,0.10) on hover
```

### Progress / Tracking Bars
Track: `var(--color-surface-highest)` or `var(--color-bg)`
Fill: `var(--color-primary)` with optional `box-shadow: 0 0 10px rgba(173,198,255,0.4)`

### Glassmorphism (floating overlays, featured panels)
```
background: rgba(50,53,60,0.60)
backdropFilter: blur(20px)
border: 1px solid rgba(173,198,255,0.20)
borderRadius: 24
```

### Live Tracking Pill
```
background: rgba(173,198,255,0.10)
border: 1px solid rgba(173,198,255,0.20)
color: #adc6ff
```
With an animated pulsing dot:
```jsx
<span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-primary)',
  animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
```

---

## Page Layout

**Standard content padding:** `32px 40px`
**Max content width:** 900–1000px, `margin: 0 auto`

### Page Header Pattern
```
padding: 32px 40px 0
display: flex, alignItems: flex-end, justifyContent: space-between

Left:  h1 (36px, 900, -0.03em) + subtitle (13px, secondary)
Right: range tabs / live tracking pill / action button
```

### Bento Grid (12-col)
Common splits used across views:
- `4fr 8fr` — Focus ring + trend chart (Dashboard)
- `60fr 40fr` — AI summary + intensity (Insights)
- `7fr 5fr` — Sessions list + AI card (Dashboard, Settings)
- `repeat(3, 1fr)` — Pattern cards (Insights)

---

## View-by-View Layout

### Dashboard (Today)
1. Header row — greeting (left) + live tracking pill (right)
2. Hero heading (36px) — `heroStatement()` output
3. **Row 1** `4/12 + 8/12`: Focus Score ring (192px SVG, quality label) | Focus Trend 7-day bar chart
4. **Full-width**: Time Distribution — horizontal stacked bar + category stat cards below
5. **Row 2** `7/12 + 5/12`: Recent Sessions cards | AI Insight card (gradient bg, goal progress bar)

### Timeline (History)
- Sticky header — title + date nav + Day/Week toggle
- Filter pills — All / Focus / Meetings / Communication / Browsing
- Vertical timeline with `paddingLeft: 64`:
  - Gradient vertical line (`left: 24px`, `rgba(66,71,84,0.5)`)
  - Per-session: icon circle (48px, `var(--color-surface-highest)`, 4px border) + session card
  - Active session: `rgba(173,198,255,0.05)` bg + primary border + pulsing dot
- Sticky glass footer — Total Deep Work | Focus % | Apps | Goal progress bar

### Apps
**List view:**
- Header: "App Usage" h1 + range tabs (Today/7d/30d)
- Category filter chips
- App rows: 56px height, icon (40px, `var(--color-surface-highest)`, borderRadius 12), name + character line, category chip, mini bar, duration

**Detail panel:**
- Breadcrumb back button
- Hero: 96px icon + h1 + category chip + range tabs
- Row 1 `4/12 + 8/12`: Total Usage (big number + sparkline) | Usage Activity (hourly bar chart, max bar glows)
- Row 2 `7/12 + 5/12`: Glass Intentionality Breakdown (progress bars) | Session History
- Footer: gradient AI Insight banner (borderRadius 32)

### Focus
- "Deep Work" h1 + context strip pill (clock icon + peak window text)
- Main timer card (`var(--color-surface-container)`, borderRadius 24, padding 40):
  - **Idle:** input (48px, `var(--color-surface-highest)`) + gradient Start button (48px)
  - **Active:** 72px monospace timer (`var(--color-primary)`) + current app teal pill + Stop button (full-width, red outline)
  - **Just finished:** "✓ Session complete" in tertiary, duration
- Stats row: 3 × `var(--color-surface-low)` cards (22px 900 values)
- Recent Sessions card — streak badge + session rows with focus/too-short dot indicators

### Insights
- "Your Week in Review" h1 + date + live pill
- Row `60fr 40fr`: AI Summary card (glassmorphism decorative blur, summary prose, stat chips) | Focus Intensity (quality label + mini bar chart)
- 3-col pattern cards (peak hours, context switching, streak)
- Actionable Intelligence glass panel (80px gradient icon box + prose + action button)
- AI chat section — starter prompt grid → message thread → pinned input bar

### Settings
- "System Preferences" h1 + subtitle
- **2-col grid `7fr 5fr`**, maxWidth 1000

  **Left (7):**
  - Profile card (80px avatar, name, "Elite Member" + "Cloud Sync" chips)
  - Time Acquisition (tracking toggle rows with 40px icon boxes)
  - App Taxonomy (category chip rows + dashed "Map New Application" button)

  **Right (5):**
  - Atmosphere (dark mode toggle + System/Light/Dark theme tabs)
  - Cognitive Augmentation (API key, focus goal input, launch on login)
  - Security & Sovereignty (data row, Web Companion linking, export, delete-all danger)
  - System (version, feedback, dev debug panel)

---

## Light Mode Compatibility

Every surface background must use a CSS variable, not a hardcoded hex. The following substitutions apply:

| Hardcoded (dark-only) | Replace with |
|---|---|
| `#272a32` | `var(--color-surface-high)` |
| `#191c22` | `var(--color-surface-low)` |
| `#32353c` | `var(--color-surface-highest)` |
| `#1d2026` | `var(--color-surface-container)` |
| `#e1e2eb` | `var(--color-text-primary)` |
| `#c2c6d6` | `var(--color-text-secondary)` |

Data colors (`#adc6ff`, `#f87171`, `#ffb95f`, etc.) are intentionally hardcoded and must NOT be replaced — they are semantic category colors, not surface colors.

SVG `stroke` and `fill` attributes inside React can use CSS variable strings (`stroke="var(--color-surface-high)"`); they resolve correctly in the Electron browser context.

---

## Sidebar

```
width: 256px
background: #0b0e14
borderRight: 1px solid rgba(50,53,60,0.15)
padding: 32px 16px
```

**Wordmark:** `fontSize: 20, fontWeight: 900, color: '#e1e2eb', letterSpacing: -0.03em`
**Subtitle:** `"INTELLIGENT MONOLITH"` — 10px, 700, 0.2em tracking, uppercase, opacity 0.5

**Nav items** — 12px, 700, 0.08em tracking, uppercase, `padding: 12px 16px, borderRadius: 8`

Active:
```
color: var(--color-primary)
borderRight: 2px solid var(--color-primary)
background: linear-gradient(90deg, rgba(173,198,255,0.10) 0%, transparent 100%)
```

Hover:
```
color: var(--color-text-primary)
background: var(--color-surface-container)
borderRight: 2px solid transparent
```

**Focus button:**
```
background: linear-gradient(135deg, #adc6ff, #4d8eff)
color: #001a42, fontWeight: 700, borderRadius: 8
```
Active session: transparent bg + `box-shadow: inset 0 0 0 1px rgba(248,113,113,0.30)`, red text.
