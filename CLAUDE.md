# NarrateRx — Project Notes

## Session Focus
At the start of EVERY new conversation, before doing anything else, ask:
"What are we working on today?" then confirm it fits one of these session types:

- **Planning / Architecture** — decisions, structure, roadmap
- **Feature: [name]** — building one specific feature end to end
- **Prompts** — writing or tuning AI prompts
- **Debug: [issue]** — one specific problem

If the work drifts into a second unrelated area mid-session, name it and suggest: "That's a good next session — want to note it and come back to it?"

## Multi-tenant SaaS
NarrateRx runs as a single shared deployment that serves multiple workspaces by subdomain (`<slug>.narraterx.ai`). Move Better People, Equine, and Animals are the three seed workspaces; external tenants self-onboard at `narraterx.ai/onboard`. All tenant-editable config — display name, voice/tone modifiers, interview/patient context, topic suggestions, output channels, publish credentials — lives in the `workspaces` row in the shared narraterx Supabase, edited via `/settings/workspace`.

The legacy `brands/<id>/` filesystem-overlay pattern and the `VITE_BRAND` / `BRAND` env vars were retired in Phase 1F (2026-05-10). Paradigm content is no longer build-time-pinned. To onboard a new tenant, use the wizard — there is no per-deployment scaffolding.

`src/lib/workspace.js` retains a static config for legacy per-brand deployments only; runtime code reads `useWorkspace()` (browser) or `workspaceContext(req)` (serverless), which resolve from the DB by subdomain.

## GitHub
Use the GitHub CLI (`gh`) for GitHub-specific interactions — PRs, issues, releases, repo management. `gh` is configured as the git credential helper, so plain `git push` / `git fetch` are fine for ref operations (they authenticate through `gh` under the hood). Do not set up separate HTTPS basic auth or raw SSH credentials.

## Email Template
The email newsletter preview renders the actual TrustDrivenCare (TDC) HTML template via `<iframe srcDoc>`. The template lives at `src/email-template.html` and is imported with Vite's `?raw` loader in `src/components/PostPreview.jsx`.

**To update the template** (e.g. after redesigning in TDC): export the master HTML from TrustDrivenCare, replace `src/email-template.html` with the new HTML, and commit. No React changes needed — all `{{merge_tags}}` are substituted at render time by `fillTemplate()` in PostPreview.jsx.

Merge tags currently in use: `{{preview_text}}`, `{{headline}}`, `{{pull_quote}}`, `{{body_paragraph_1}}`, `{{body_paragraph_2}}`, `{{body_paragraph_3}}`, `{{cta_text}}`, `{{cta_url}}`, `{{ps_text}}`, `{{hero_image_url}}`, `{{year}}`, `{{unsubscribe_url}}`, `{{webview_url}}`.
