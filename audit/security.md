# Phase 3 — Security Audit

**Date:** 2026-05-11  
**Branch:** audit/security  
**Scope:** All `api/` endpoints, all `src/` JSX/JS, `vercel.json`, `package.json`, dependency tree

---

## Summary

| Severity | Count | Auto-fixed | Needs decision |
|---|---|---|---|
| Critical | 0 | — | — |
| High | 0 | — | — |
| Medium | 2 | 1 | 1 |
| Low | 2 | 1 | 1 |
| Info | 2 | 0 | 0 |

---

## Findings

### SEC-01 — Missing HTTP Security Headers
**Severity:** Medium  
**File:** `vercel.json`  
**Status:** ✅ Auto-fixed

No response headers were set for `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, or `Referrer-Policy`. These are baseline hardening headers expected by security scanners and OWASP guidelines.

**Fix applied:** Added `headers` block to `vercel.json` covering all routes:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 0` (modern browsers — defer to browser default; not replacing with CSP since a strict CSP for this Vite+Clerk SPA requires significant config)

---

### SEC-02 — Rate Limiting Gap on Write Endpoints
**Severity:** Medium  
**Files:** `api/collections/index.js` (POST), `api/db/interviews.js` (POST), `api/publish/buffer.js`, `api/publish/website.js`  
**Status:** 🔴 Needs decision

Upstash rate limiting is applied to AI generation and media upload endpoints (PR #293). However, four write endpoints have no rate limiting:

| Endpoint | Risk |
|---|---|
| `POST /api/collections` | Unlimited collection creation |
| `POST /api/db/interviews` | Unlimited interview record creation |
| `POST /api/publish/buffer` | Unlimited outbound API calls to Buffer |
| `POST /api/publish/website` | Unlimited website publish triggering |

All four are Clerk-authenticated (workspace-scoped), so the risk is a compromised session token, not an anonymous attacker. The Buffer and website publish endpoints are higher priority since they trigger external side effects.

**Recommendation:** Extend the existing Upstash rate limiter to these four endpoints using the same workspace-scoped key pattern as `api/media/upload.js`. Limits: 20 req/min for publish endpoints, 60 req/min for DB write endpoints.

**Decision needed:** Proceed with rate-limit extension, or accept current posture given the Clerk auth layer?

---

### SEC-03 — iframe sandbox="allow-same-origin"
**Severity:** Low  
**File:** `src/components/PostPreview.jsx:583`  
**Status:** ✅ Auto-fixed

The email preview iframe used `sandbox="allow-same-origin"`, which grants the iframe document access to the parent's origin — including cookies, localStorage, and IndexedDB. The template content is controlled (from `src/email-template.html` with merge tags filled server-side), but defense-in-depth favors the most restrictive sandbox for rendered HTML.

**Fix applied:** Changed to `sandbox=""` (empty = fully sandboxed: no scripts, no same-origin access, no forms, no popups). The TDC email template uses only inline CSS, so rendering is unaffected.

---

### SEC-04 — npm audit: 2 Moderate Vulnerabilities (esbuild/vite)
**Severity:** Low  
**Package:** `esbuild` (transitive via `vite <=6.4.1`)  
**Status:** 🔴 Needs decision (minor/major bump)

`npm audit` reports 2 moderate vulnerabilities in `esbuild` (GHSA-67mh-4wv8-2f99): a development server can be queried cross-origin. This only affects the **dev server**, not production builds or deployed functions.

Fix requires `npm audit fix --force` which upgrades Vite to v8 (breaking change). Vite 7 is also available as a non-breaking path — worth evaluating against Vite 7 compat first.

**Decision needed:** Defer (dev-only risk, not production), or upgrade Vite as a separate PR?

---

### SEC-05 — No Content-Security-Policy
**Severity:** Info  
**File:** `vercel.json`  
**Status:** ℹ️ Noted — not auto-fixed

A strict CSP would provide additional XSS protection. Not applied because this Vite SPA with Clerk (which injects iframes and scripts from `clerk.narraterx.ai`, `accounts.narraterx.ai`, Clerk CDN, and Stripe) requires a permissive CSP that adds complexity without proportionate benefit at this stage. Recommend revisiting if the app grows third-party script surface.

---

### SEC-06 — Workspace Isolation (All Routes Verified)
**Severity:** Info  
**File:** All 36 `api/` endpoints  
**Status:** ✅ Verified clean

All API routes that access tenant-scoped tables call either `workspaceContext(req)` or `workspaceById()` and filter every query by `workspace_id`. No cross-tenant data access paths were found. The enforcement is at the application layer (no RLS), consistent with the documented architecture in `CLAUDE.md`.

No XSS vectors found (`dangerouslySetInnerHTML` is not used anywhere in the codebase; the email iframe now carries an empty sandbox). No secrets found in client-side code — all sensitive values are in Vercel env vars or `workspace_credentials`.

---

## Auto-fixes Applied

| ID | File | Change |
|---|---|---|
| SEC-01 | `vercel.json` | Added X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy headers |
| SEC-03 | `src/components/PostPreview.jsx:583` | `sandbox="allow-same-origin"` → `sandbox=""` |

## Items Awaiting Decision

| ID | Priority | Description |
|---|---|---|
| SEC-02 | Medium | Extend rate limiting to 4 write endpoints (publish/buffer, publish/website, collections POST, interviews POST) |
| SEC-04 | Low | Vite upgrade to fix esbuild dev-server vuln (dev-only, not production) |
