// Sentry stubs — 2026-05-14.
//
// Sentry was deferred (off-roadmap, no paying tenants yet). To avoid touching
// the 40+ call sites that already reference `initSentry` / `setSentryUser` /
// `setSentryWorkspace` / `captureException` across the app, the export surface
// is preserved as no-ops and the @sentry/react SDK is uninstalled.
//
// To re-enable: restore the original implementation from PR #287
// (commit c1ccf57) and reinstall @sentry/react.
//
// All callers also log to console.* — Vercel logs / browser devtools remain
// the source of truth for error visibility until Sentry is revived.

export function initSentry() {}
export function setSentryUser() {}
export function setSentryWorkspace() {}
export function captureException() {}
