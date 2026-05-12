# Phase 8 — SEO & Metadata Audit

**Date:** 2026-05-11  
**Branch:** audit/seo  
**Scope:** `index.html`, `public/`, `src/lib/useDocumentTitle.js`, all pages

---

## Summary

| Area | Status | Findings |
|---|---|---|
| `<meta name="description">` | ✅ Present | Good copy |
| OG tags | ✅ Present | `og:url` and `twitter:image:alt` added |
| Favicon / apple-touch-icon | ✅ Present | SVG icon |
| Font loading | ✅ Present | preconnect + display=swap |
| `robots.txt` | ❌ Missing | Created |
| `sitemap.xml` | N/A | SaaS app — auth-gated, no sitemap needed |
| Per-page document titles | ⚠️ Partial | 5 pages missing — all fixed |
| `og:image` format | ⚠️ SVG | Social platforms prefer PNG; noted |

---

## Findings

### SEO-01 — 5 pages missing `useDocumentTitle`
**Severity:** Medium  
**Files:** `Strategy.jsx`, `Integrations.jsx`, `WorkspaceSettings.jsx`, `ClinicianProfile.jsx`, `Onboarding.jsx`  
**Status:** ✅ Auto-fixed

These pages left the browser tab title as the static `"NarrateRx"` from `index.html` instead of updating it to reflect the active page. This affects:
- Browser history readability (all entries show "NarrateRx")
- Accessibility (screen readers announce the static title)
- Tab-switcher recognition when multiple tabs are open

**Fix applied:** Added `useDocumentTitle` to all 5 pages:

| Page | Title |
|---|---|
| `Strategy.jsx` | `Strategy · NarrateRx` |
| `Integrations.jsx` | `Integrations · NarrateRx` |
| `WorkspaceSettings.jsx` | `Settings — Workspace · NarrateRx` |
| `ClinicianProfile.jsx` | `Clinician · NarrateRx` |
| `Onboarding.jsx` | `Get started · NarrateRx` |

---

### SEO-02 — Missing `robots.txt`
**Severity:** Medium  
**File:** `public/robots.txt` (missing)  
**Status:** ✅ Auto-fixed

No `robots.txt` existed. Without it, search crawlers would follow the SPA rewrite rules and attempt to index all auth-gated routes (which all return the same shell HTML — not useful content).

**Fix applied:** Created `public/robots.txt` with `Disallow: /` for all agents. NarrateRx is a B2B SaaS app with invite-only acquisition; no routes benefit from organic indexing.

---

### SEO-03 — Missing `og:url` and `twitter:image:alt`
**Severity:** Low  
**File:** `index.html`  
**Status:** ✅ Auto-fixed

`og:url` (the canonical URL for link unfurls) was absent. `twitter:image:alt` (screen reader text for the image in Twitter/X cards) was also missing.

**Fix applied:**
- Added `<meta property="og:url" content="https://narraterx.ai" />`
- Added `<meta name="twitter:image:alt" content="NarrateRx — AI content for clinics" />`

---

### SEO-04 — `og:image` uses SVG
**Severity:** Low  
**File:** `index.html:19`  
**Status:** 🔴 Noted — not auto-fixed (requires new PNG asset)

`og:image` points to `/narraterx-icon.svg`. Major social platforms (Facebook, LinkedIn, Slack) do not support SVG as an OG image — they either display a broken image or fall back to a generic thumbnail. Twitter/X requires PNG or JPEG for card images.

**Decision needed:** Create a 1200×630px PNG social share image (the standard OG image size) and update `og:image` to point to it. The existing `/narraterx-icon.svg` could be used as the base artwork.

---

### SEO-05 — No sitemap
**Severity:** Info — not applicable for this app  
**Status:** ✅ Accepted

A `sitemap.xml` is unnecessary for an auth-gated SaaS app. All routes require authentication and there is no public-facing content to index. The `Disallow: /` in `robots.txt` (SEO-02) makes a sitemap redundant.

---

### SEO-06 — Page metadata already strong
**Severity:** Info  
**Status:** ✅ Clean

Already correct in `index.html`:
- `<meta name="description">` with clear value prop copy
- `<meta name="theme-color">` for Android browser chrome
- SVG favicon + Apple touch icon
- Full Open Graph set (type, site_name, title, description, image)
- Twitter card metadata
- `<html lang="en">` for language declaration
- Font preconnect + `display=swap`

The `useDocumentTitle` hook is well-designed: it appends `" · NarrateRx"` consistently and restores the previous title on unmount, so navigating between routes keeps tab titles accurate.

---

## Auto-fixes Applied

| ID | File(s) | Change |
|---|---|---|
| SEO-01 | 5 page files | `useDocumentTitle` added |
| SEO-02 | `public/robots.txt` | Created with `Disallow: /` |
| SEO-03 | `index.html` | `og:url` + `twitter:image:alt` added |

## Items Awaiting Decision

| ID | Priority | Description |
|---|---|---|
| SEO-04 | Low | Create 1200×630 PNG social share image to replace SVG in `og:image` |
