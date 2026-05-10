# WordPress publishing credentials

NarrateRx publishes blog posts to a WordPress site via the WordPress REST API. The four values on the **WordPress** card in `/settings/workspace` → Publishing credentials are everything the publish handler needs.

This doc maps each field to where it lives, why we need it, how to mint it, and how to rotate it. The worked example at the bottom is pre-filled for the **movebetter-equine** workspace (movebetterequine.com).

---

## Why these values

At publish time, [api/publish/website.js](../api/publish/website.js) detects WordPress mode (workspace has a `wordpress` credential) and:

1. Sends `GET {site}/wp/v2/posts?slug=...` to check for slug collisions (rejects with `slug_taken` rather than letting WP auto-suffix).
2. If a hero image is attached, downloads it and `POST`s the bytes to `{site}/wp/v2/media`.
3. Resolves each tag name to a term ID, creating tags that don't exist via `POST {site}/wp/v2/tags`.
4. Creates the post with `POST {site}/wp/v2/posts` (status `draft` or `publish` depending on the toggle).

Authentication is HTTP Basic with a **WordPress Application Password** — a per-app token minted from the WP admin profile page. It is not the user's login password, and it bypasses 2FA. Application Passwords were added in WP 5.6 and are the standard for REST API integrations.

---

## Where each value lives

| Field on the card | Sensitivity | What it is |
|---|---|---|
| Site URL (must include /wp-json/) | Not sensitive | The REST root of the receiving WP site, e.g. `https://movebetterequine.com/wp-json/wp/v2/posts`. The handler trims back to `/wp-json` and builds endpoint paths from there. |
| WordPress username | Mildly sensitive | The login (`user_login`) of the WP user the Application Password was minted under. Half-of-a-pair with the app password. |
| Application password | **Sensitive** | A 24-character token (with spaces) WP generates when you create an Application Password in your profile. Shown **once**. Bypasses 2FA. Rotate by revoking and minting a new one. |
| (none) | — | There are only three fields; the publish handler does not need a separate API endpoint. |

### Site URL — derivation

Take the public site URL (e.g. `https://movebetterequine.com`) and append `/wp-json/wp/v2/posts`. The handler in [api/publish/website.js:290](../api/publish/website.js#L290) (`wpRestRoot`) splits at `/wp-json/` so any path after it is fine — but pasting the full posts endpoint matches the placeholder and is unambiguous.

If `/wp-json/` returns 404 on the site, REST has been disabled by a security plugin (Wordfence, iThemes Security) — fix that on the WP side first; this credential cannot work without it.

### WordPress username — choosing a user

Do **not** use the site owner's primary admin login. Use a dedicated REST-API user with the smallest role that can publish:

- **Editor** — recommended. Can publish posts and upload media in any category. Cannot install plugins or manage users.
- **Author** — works only if all NarrateRx posts go under a single author and the user has `publish_posts`. Cannot edit other users' posts.
- **Administrator** — overkill; only if the site has unusual capability filtering.

Suggested username: `narraterx` (or `narraterx-publisher`). One account per integration so the audit trail in WP shows "this post was published by NarrateRx" rather than impersonating a human editor.

### Application password — minting

In WP admin (`https://<site>/wp-admin/`), as the user the password will belong to:

1. **Users → Profile** (or **Users → All Users → Edit** if minting on behalf of another account; you must be an admin).
2. Scroll to **Application Passwords** at the bottom.
3. **New Application Password Name**: `NarrateRx` (anything memorable; visible in the list later for revocation).
4. Click **Add New Application Password**.
5. Copy the 24-character token shown (formatted with spaces, e.g. `abcd EFGH ijkl MNOP qrst UVWX`). **WP will not show it again.**
6. Paste into the Application password field in `/settings/workspace`.

The handler strips whitespace from the secret before authenticating ([api/publish/website.js:131](../api/publish/website.js#L131)), so it does not matter whether you keep the spaces.

If the **Application Passwords** section is missing on the Profile page:
- WP version is below 5.6 (upgrade).
- A security plugin or `wp_is_application_passwords_available` filter is disabling the feature (re-enable, or use a plugin that re-exposes it).
- The site is served over plain HTTP — application passwords are HTTPS-only by default.

---

## Rotation walkthrough

Rotating the Application Password is the only routine maintenance. Site URL and username only change if the site moves domains or you switch to a different publisher account.

1. **Mint the new password first** (don't revoke the old one yet — that breaks publishing during the swap):
   - WP admin → Users → Profile → Application Passwords → name it `NarrateRx <YYYY-MM-DD>` → **Add New Application Password** → copy the token.
2. **Verify the new credential works** before touching the workspace settings:
   ```
   node scripts/wp-verify.mjs https://movebetterequine.com narraterx "<NEW_APP_PASSWORD>"
   ```
   Expect `200 OK` with the matching user and a `capabilities` map showing `publish_posts: true`. If it fails, you minted under the wrong user or copied the token wrong — fix before continuing.
3. **Update the workspace credential**: `/settings/workspace` → Publishing credentials → WordPress → paste the new app password (and re-paste the username if it changed) → Save. Card flips to **Configured**.
4. **Smoke-test an end-to-end publish**: in `https://movebetter-equine.narraterx.ai/`, open any post → Review Post → Publish to WordPress with the **Draft** toggle on → confirm the draft appears in WP admin → Posts → Drafts.
5. **Revoke the old password**: WP admin → Users → Profile → Application Passwords → click **Revoke** next to the previous entry.
6. **Update 1Password** with the new value and rotation date (template below).

If the old password leaks (committed to git, posted in chat, sent in an email), revoke it **immediately** in WP admin before minting a replacement — the revoke is what makes it safe again, not the rotation.

---

## 1Password Secure Note template

| Field | Value |
|---|---|
| **Item type** | API Credential |
| **Title** | `NarrateRx — WordPress App Password (movebetter-equine)` |
| **Vault** | The vault holding your other movebetter-equine production keys |
| **Username** | `narraterx` (the WP user) |
| **Password / Value** | the 24-character app password (with or without spaces) |
| **Website** | `https://movebetterequine.com/wp-admin/` |
| **Notes** | WordPress Application Password used by NarrateRx to publish blog posts to movebetterequine.com via REST. Set on the `narraterx` WP user (Editor role). Stored in `workspace_credentials` (`service=wordpress`) for the movebetter-equine workspace. Also pasted in `/settings/workspace`. To rotate: mint new in WP admin → Users → Profile → Application Passwords; verify with `scripts/wp-verify.mjs`; update workspace settings; revoke old in WP admin. If lost: log into WP admin, revoke the entry, mint a fresh one — no recovery, the token is one-shot. Generated YYYY-MM-DD. |

---

## Worked example — movebetter-equine

Pre-filled with the values that don't require pulling Sensitive secrets:

| Field | Value |
|---|---|
| Site URL (must include /wp-json/) | `https://movebetterequine.com/wp-json/wp/v2/posts` |
| WordPress username | `narraterx` *(verify against the WP `narraterx-equine` Vercel project's `WORDPRESS_USER` env var; if a different login was used historically — e.g. `narraterx-publisher` or the owner's email — match that exact value so the same user can re-mint without creating a new account)* |
| Application password | `<REDACTED — mint fresh in WP admin per above>` |

Once pasted into `/settings/workspace` → WordPress → Save:

```
node scripts/wp-verify.mjs https://movebetterequine.com narraterx "<APP_PASSWORD>"
```

should return 200 with the equine WP user and `publish_posts: true` in capabilities.
