# Voice Settings Redesign — Component Mapping (Option B)

**Canonical mockup**: [voice-settings-redesign.html](./voice-settings-redesign.html) — Option B column (sky-blue header) is the target.

This note locks down how each mockup element maps to existing primitives **before** code is written. The goal is to prevent the "looks 70% like the mockup" failure mode by making substitution choices deliberate, not accidental.

## Route + nav structure (PR #1)

| Mockup element | Target file | Notes |
|---|---|---|
| Left rail "Bernard" sub-group | `src/components/SettingsLayout.jsx` | Extend `GROUPS` schema so an item can have nested `items`. Sub-items render indented (~`pl-5`) and use the same `SidebarItem` active-state styling. |
| Sub-item: Voice & tone | `/settings/workspace/voice` | Route already exists, page replaced in PR #2. |
| Sub-item: Patients & topics | `/settings/workspace/patients` | New route. PR #1 renders existing `VoiceSettings` as a placeholder so the route works; PR #3 ships the real page. |
| Sub-item: Interview defaults | `/settings/workspace/interview-defaults` | New route. PR #1 renders existing `VoiceSettings` placeholder; PR #4 ships the real page. |
| Breadcrumb "Settings · Bernard · Voice & tone" | New small `<Breadcrumb>` in each new page | Plain `<p class="text-2xs text-muted-foreground">`, no new shadcn dep. |

## Mockup → primitives (page content)

| Mockup pattern | Implementation | Why |
|---|---|---|
| Amber "Bernard's brief, as he reads it" callout with "Try a live preview" button | Existing `Card` is wrong (no amber variant). Build inline: `<div class="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5">` + `Button size="sm" variant="outline"` for preview. Identical class set already used by `WorkingSummaryCallout` ([VoiceSettings.jsx:654](src/pages/settings/VoiceSettings.jsx:654)) — reuse those exact classes for visual consistency. | Don't introduce a new variant prop on `Card` for one use. Inline div with matching classes is the right level. |
| Section header pattern (uppercase tracking-wider label + content) | Existing `Section` from `components/settings/helpers.jsx` — already does this. | DO NOT roll a new one. |
| Field label + input | Existing `Field` helper. | Already used everywhere in settings. |
| Field label + textarea | Existing `Textarea2` helper. | Already used everywhere in settings. |
| Tone-mode row (emoji + name + truncated preview + chevron, collapsed by default) | Keep existing `ToneCard` from `VoiceSettings.jsx:756` verbatim. | Already matches the mockup's visual exactly. |
| Tone-mode "Using system default" italic hint | Modify `ToneCard` to accept a `systemDefault` prop and render it inline when value is empty. New code, ~5 lines. | Mockup shows the default text as a hint; current code just says "No modifier — using defaults." |
| Sticky SaveBar | Existing `SaveBar` from `components/settings/helpers.jsx`. | Already used. |
| "Next: Patients & topics →" link at bottom of Voice & tone page | New `<NavLink>` next to SaveBar. | Plain Tailwind, no new primitive. |

## Anti-patterns to avoid (lessons from prior drift)

1. **Don't introduce new shadcn variants for one-off styles.** The amber callout is inline classes, not a new `Card` variant. Variants accumulate forever.
2. **Don't reach for new primitives mid-build.** If a mockup element doesn't have an entry above, stop and add one before coding. No improvisation.
3. **Don't reshape existing helpers.** `Section`, `Field`, `Textarea2`, `SaveBar` stay as-is. The only helper change in this redesign is `ToneCard` gaining a `systemDefault` prop.
4. **Don't fold three pages into one "shared" component.** Each new page is its own file (`VoiceSettings.jsx`, `PatientsAndTopicsSettings.jsx`, `InterviewDefaultsSettings.jsx`). Sharing happens through `helpers.jsx`, not through over-abstraction.

## Fidelity gate (every PR in this series)

Before opening any PR in this series, the PR description must include a side-by-side:

| | Mockup | Live preview URL |
|---|---|---|
| Voice & tone | [screenshot from mockup](./voice-settings-redesign.html) | Vercel preview deployment screenshot |

If the live preview diverges from the mockup, either:
- Fix it before opening the PR, or
- Note the divergence explicitly in the PR description with a reason.

No "looks roughly right" merges.

## PR sequence

| PR | Scope | Risk |
|---|---|---|
| **#1** (this PR) | Mockup + this mapping doc committed. Nav extended with Bernard sub-group. 3 routes wired, all rendering current `VoiceSettings` for backward compat. | Low. Pure additive routing + nav. |
| **#2** | Build new lean Voice & tone page (`/settings/workspace/voice`). Old fat page survives at the other two routes. | Medium. New page logic. |
| **#3** | Build Patients & topics page (`/settings/workspace/patients`). Move archetypes + patient context + topics + structured condition-bank editor here. Old fat page no longer reachable. | Medium. Most content; needs structured editor for condition bank (replaces 18-row JSON textarea). |
| **#4** | Build Interview defaults page (`/settings/workspace/interview-defaults`). Move slot editors here. Move per-clinician voice-memory section to its destination (TBD: ClinicianProfile vs. new clinicians list page). | Low. Mostly relocation. |
