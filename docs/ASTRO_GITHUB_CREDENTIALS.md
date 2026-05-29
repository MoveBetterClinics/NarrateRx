# Astro + GitHub publishing credentials — where each value lives

For the `movebetter-animals` workspace (and any future workspace publishing to an Astro+GitHub-backed site), the **Settings → Publishing credentials → Astro + GitHub website** card needs two values. Both are easy to lose track of because one is a Sensitive shared secret that lives on **two** sides — NarrateRx and the Astro deployment — and they must match exactly.

At publish time NarrateRx serializes the blog post (slug, title, description, pubDate, markdown, optional heroImage / heroImageAlt / tags / draft / images[]) and `POST`s it as JSON to the webhook URL with `Authorization: Bearer <secret>`. The receiving Astro app validates the bearer, writes a markdown file to its content directory, commits to GitHub, and lets Vercel rebuild. The full receiver contract lives at `docs/api-publish-contract.md` in the `movebetteranimal` repo.

**Book publish (added 2026-05-26)**: the same lane also carries the workspace book, dispatched on a new `kind: 'book'` field in the payload. The receiver writes a single fixed file (`src/pages/book.astro`), overwrites on every publish, and renders at `https://<site>/book`. Full contract: [`docs/BOOK_PUBLISH_CONTRACT.md`](./BOOK_PUBLISH_CONTRACT.md). Receivers that haven't been updated yet return `400` and NarrateRx surfaces it as `receiver_out_of_date` to the admin.

**`images[]` (added 2026-05-15, mirror-on-publish)**: an array of `{ url, alt, filename, mirrorable }` entries pulled from inline `![alt](…)` references in the post markdown. The receiver should, for each entry where `mirrorable: true`, fetch `url`, commit the bytes to `src/assets/blog/<slug>/<filename>` in the same commit as the post markdown, and rewrite the post's `![alt](url)` to point at the repo-relative path. Receivers that ignore the field still render correctly because the original `url` is a public Vercel Blob URL — mirroring just severs the dependency on NarrateRx infra. `heroImage` is **not** included in `images[]`; it's handled separately as frontmatter.

## The two fields

### 1. Publish webhook URL — `Mildly sensitive`

**Source**: the Astro deployment that receives publish requests. The URL is whatever path on the Astro site implements the publish receiver — by convention, `/api/publish` on the marketing domain.

For `movebetter-animals`: `https://movebetteranimalchiro.com/api/publish`.

> Domain history: this site was at `movebetteranimal.co` through 2026-05-10, then renamed to `movebetteranimalchiro.com` to match the "Move Better Animals Chiropractic" brand. The old `.co` domain stays attached to the Astro Vercel project with a permanent (301) redirect to the new domain, so old blog post URLs and printed collateral keep working.

This URL is not a secret in the OWASP sense — knowing it doesn't grant access without the bearer — but it points at an internal integration surface, so we treat it as Mildly sensitive (don't broadcast publicly).

### 2. Shared bearer secret — `Sensitive`

**Source**: the same secret value lives in **two** places that must stay in sync:

- **NarrateRx side**: encrypted in `workspace_credentials.secret_ciphertext` for `(workspace='movebetter-animals', service='astro_github')`. Originally also lived as the `NARRATERX_PUBLISH_SECRET` env var on the legacy `narraterx-animals` Vercel project; that value was marked **Sensitive** there and so `vercel env pull` returns empty for it (see `feedback_vercel_sensitive_env_pull_empty.md`).
- **Astro deployment side**: env var on the `movebetteranimalchiro.com` Vercel project (probably named `NARRATERX_PUBLISH_SECRET` to match the NarrateRx side, but the receiver picks whichever env name it reads). The Astro `/api/publish` handler compares the inbound `Authorization: Bearer …` header against this env var.

The two values **must match byte-for-byte**. A mismatch produces HTTP 401 from the Astro side, which NarrateRx surfaces as `error: 'auth_failed'` in the publish UI.

There is no third source of truth. If you don't have it in 1Password or the Astro project's env vars, your only recovery path is to mint a new shared secret and update both sides — see the rotation walkthrough below.

---

## Rotating the shared secret — end-to-end walkthrough

Because the secret lives on two sides, rotation is a coordinated update. Doing only one side breaks publishing immediately.

**Time required**: ~5 minutes, plus one Astro redeploy (~1–2 minutes for Vercel build).

### Step 1 — generate a new shared secret

Anywhere with a shell:

```
openssl rand -base64 32
```

The output is ~44 characters of base64. Copy it once; it's the value you'll paste into both sides.

### Step 2 — paste into the Astro deployment first

Set the env var on the receiving Vercel project (the one that hosts `movebetteranimalchiro.com`) **before** updating NarrateRx. Publish requests with the *old* secret will fail during the gap; doing Astro first means the window is just the redeploy time, not the time it takes you to copy-paste.

1. Open https://vercel.com → switch to the project that hosts `movebetteranimalchiro.com`.
2. **Settings → Environment Variables**.
3. Find `NARRATERX_PUBLISH_SECRET` (or whatever env name the receiver reads — check `api/publish.ts` in the `movebetteranimal` repo if unsure).
4. Edit → paste the new value → save.
5. **Redeploy production** so the new value is live. The redeploy isn't optional — Vercel env var changes don't apply to running deployments until the next build.

### Step 3 — paste into NarrateRx

1. Open `https://movebetter-animals.narraterx.ai/settings/workspace`.
2. Scroll to **Publishing credentials** → expand the **Astro + GitHub website** card.
3. Paste the same secret into the **Shared bearer secret** field.
4. Leave the **Publish webhook URL** field as-is (it doesn't change on secret rotation).
5. Click **Save**.

The "Configured" badge stays green; the encrypted value in `workspace_credentials.secret_ciphertext` is replaced.

### Step 4 — verify

```
node scripts/astro-verify.mjs https://movebetteranimalchiro.com/api/publish "<new-secret>"
```

Or send a test publish from the Review Post UI with the **Draft** toggle on so it lands as an unpublished entry on the Astro side.

### Step 5 — update 1Password

Open the existing `NarrateRx — movebetter-animals Astro+GitHub credentials` Secure Note. Replace the secret value in the Notes body. Update the "Key rotated" date. Save.

---

## Verification helper

`scripts/astro-verify.mjs` sends a minimal probe payload to the webhook URL with the bearer header set. It does **not** send a real publish — it sends an intentionally-invalid payload and inspects the response code to disambiguate the auth and connectivity outcomes:

- **401** → bearer secret doesn't match. Re-check the NarrateRx side against the Astro side.
- **400** → bearer was accepted (auth passed), Astro side rejected the payload as invalid (expected — the probe payload is missing required fields). This is **success** for the purpose of credential verification.
- **404 / DNS failure** → the URL is wrong.
- **5xx** → the Astro deployment is misconfigured or down (typically missing its own GitHub token env var).

Usage:

```
node scripts/astro-verify.mjs https://movebetteranimalchiro.com/api/publish "<shared-secret>"
```

The script never sends a payload the Astro side could mistake for a real post — `slug: '__narraterx_verify__'` plus a deliberately empty `markdown` triggers the 400 path. If you ever change the Astro receiver to start writing minimum-viable posts from any well-formed payload, update this script.

---

## Save the values to 1Password

After pasting into NarrateRx, mirror everything into 1Password so future-you (or whoever rotates next) has a single source of truth.

### Item header

| Field | Value |
|---|---|
| **Item type** | Secure Note |
| **Title** | `NarrateRx — movebetter-animals Astro+GitHub credentials` |
| **Vault** | The vault holding your other production NarrateRx / Move Better credentials |
| **Website** (optional) | `https://movebetter-animals.narraterx.ai/settings/workspace` |

### Notes body (copy-paste template)

Replace each `<...>` placeholder with the actual value.

```
Workspace:    movebetter-animals
URL:          https://movebetter-animals.narraterx.ai
Settings:     https://movebetter-animals.narraterx.ai/settings/workspace
Set date:     <YYYY-MM-DD>
Key rotated:  <YYYY-MM-DD>

These credentials let NarrateRx POST blog posts to the Astro site at
movebetteranimalchiro.com. The shared secret is mirrored on the receiving
Vercel project's env vars; rotating one side without the other breaks
publishing. Full rotation walkthrough: docs/ASTRO_GITHUB_CREDENTIALS.md.

────────────────────────────────────────────
FIELD 1 — Publish webhook URL
Sensitivity: Mildly sensitive
────────────────────────────────────────────
Value:    https://movebetteranimalchiro.com/api/publish
Source:   The Astro deployment for movebetteranimalchiro.com (Vercel project).
          Path is whatever the receiver implements; conventionally /api/publish.
Rotation: Stays stable unless the receiving site's URL or path changes.

────────────────────────────────────────────
FIELD 2 — Shared bearer secret
Sensitivity: Sensitive
────────────────────────────────────────────
Value:    <paste the secret here — same value as set on the Astro side>

Source:   Mirrored in two places that must match byte-for-byte:
            1. NarrateRx workspace_credentials row (encrypted)
            2. movebetteranimalchiro.com Vercel project env var
               (NARRATERX_PUBLISH_SECRET or equivalent — check the
                receiver source if unsure)
Rotation: Generate new with `openssl rand -base64 32`. Paste into the
          Astro Vercel project's env var FIRST and redeploy, then into
          NarrateRx Workspace Settings. Full procedure:
          docs/ASTRO_GITHUB_CREDENTIALS.md "Rotating the shared secret".

────────────────────────────────────────────
RECOVERY SCENARIO
────────────────────────────────────────────
If this 1Password entry is lost:
  • Field 1 is recoverable from the movebetteranimalchiro.com Vercel
    project's domain settings in seconds.
  • Field 2 may be recoverable from the Astro deployment's env vars
    (Vercel dashboard → Settings → Environment Variables → reveal the
    NARRATERX_PUBLISH_SECRET value). If that value is also marked
    Sensitive (can't be revealed), rotate per the walkthrough above —
    rotation is non-destructive aside from the brief redeploy window.
```

---

## Worked example — `movebetter-animals`

The values below are the real 1Password entry shape for the animals workspace. The `Sensitive` shared secret is **deliberately omitted** — that value should never appear in this repo or any checked-in document.

| Field | Value |
|---|---|
| **Item type** | Secure Note |
| **Title** | `NarrateRx — movebetter-animals Astro+GitHub credentials` |
| **Vault** | Move Better — Operations (or wherever production NarrateRx secrets live) |
| **Website** | `https://movebetter-animals.narraterx.ai/settings/workspace` |

```
Workspace:    movebetter-animals
URL:          https://movebetter-animals.narraterx.ai
Settings:     https://movebetter-animals.narraterx.ai/settings/workspace
Set date:     2026-05-10
Key rotated:  <inherited from legacy narraterx-animals — set date unknown>

These credentials let NarrateRx POST blog posts to the Astro site at
movebetteranimalchiro.com. The shared secret is mirrored on the receiving
Vercel project's env vars; rotating one side without the other breaks
publishing. Full rotation walkthrough: docs/ASTRO_GITHUB_CREDENTIALS.md.

────────────────────────────────────────────
FIELD 1 — Publish webhook URL
Sensitivity: Mildly sensitive
────────────────────────────────────────────
Value:    https://movebetteranimalchiro.com/api/publish
Source:   The movebetteranimalchiro.com Vercel project (Astro app).

────────────────────────────────────────────
FIELD 2 — Shared bearer secret
Sensitivity: Sensitive
────────────────────────────────────────────
Value:    <REDACTED — retrieve from legacy narraterx-animals Vercel
           project (NARRATERX_PUBLISH_SECRET) OR from the receiving
           movebetteranimalchiro.com Vercel project (same env var name).
           If neither side can reveal the existing value, rotate per
           docs/ASTRO_GITHUB_CREDENTIALS.md.>

────────────────────────────────────────────
RECOVERY SCENARIO
────────────────────────────────────────────
Field 1: recoverable from the movebetteranimalchiro.com Vercel project.
Field 2: try the movebetteranimalchiro.com Vercel env vars first; if not
         revealable, rotate (non-destructive aside from a brief
         redeploy window on the Astro side).
```
