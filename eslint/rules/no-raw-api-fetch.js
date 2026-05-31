// Custom ESLint rule: ban tokenless raw `fetch('/api/...')` calls in client code.
//
// Background. The 2026-05-30 settings bug (PR #1064): five pages loaded
// `/api/workspace/me` with a bare `fetch()` that attached no Authorization
// header. The API auth layer (api/_lib/auth.js → requireRole) authenticates
// ONLY from the Bearer token — the session cookie is ignored — so a tokenless
// GET silently received the slim public-branding shape, dropping every tenant
// field (enabled_outputs, plan, locations, …). Saved settings then "reverted"
// on reload because the read-back couldn't see them.
//
// The fix everywhere is `apiFetch` / `apiFetchResponse` (src/lib/api.js), which
// attaches the Clerk token (plus wrong-org retry). This rule catches the next
// tokenless call at write-time instead of in production.
//
// Intentionally CONSERVATIVE — it only fires when it can prove the call carries
// no auth. A `fetch()` whose init or headers can't be analyzed statically
// (headers passed as a variable, an object spread, a computed key, etc.) is
// given the benefit of the doubt and NOT flagged. So this rule produces few/no
// false positives on the existing authenticated saves. A genuinely public
// endpoint (no token by design) should use `apiFetch(path, { auth: false })`
// or carry an inline `// eslint-disable-next-line narraterx/no-raw-api-fetch`
// with a one-line reason.

// The apiFetch/apiFetchResponse wrappers themselves legitimately call fetch().
const ALLOWED_FILES = ['src/lib/api.js']

function isAllowedFile(filename) {
  return ALLOWED_FILES.some((suffix) => filename.endsWith(suffix))
}

// `fetch(...)`, `window.fetch(...)`, `globalThis.fetch(...)`, `self.fetch(...)`.
function isFetchCallee(callee) {
  if (callee.type === 'Identifier') return callee.name === 'fetch'
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'fetch' &&
    callee.object.type === 'Identifier' &&
    (callee.object.name === 'window' ||
      callee.object.name === 'globalThis' ||
      callee.object.name === 'self')
  )
}

// First argument resolves to a string starting with `/api/`?
// Handles string literals and template literals (`/api/foo/${id}`).
function isInternalApiPath(arg) {
  if (!arg) return false
  if (arg.type === 'Literal' && typeof arg.value === 'string') {
    return arg.value.startsWith('/api/')
  }
  if (arg.type === 'TemplateLiteral' && arg.quasis.length > 0) {
    return (arg.quasis[0].value?.cooked ?? '').startsWith('/api/')
  }
  return false
}

function keyName(prop) {
  if (prop.key.type === 'Identifier') return prop.key.name
  if (prop.key.type === 'Literal') return String(prop.key.value)
  return null
}

// 'has-auth' | 'no-auth' | 'unknown'. 'unknown' = can't tell statically → do
// not flag.
function authStatus(initArg) {
  if (!initArg) return 'no-auth' // fetch(path) — no init, so no header
  if (initArg.type !== 'ObjectExpression') return 'unknown' // fetch(path, opts) — opts is a var

  let headersProp = null
  for (const prop of initArg.properties) {
    if (prop.type === 'SpreadElement') return 'unknown' // { ...opts } could carry headers
    if (prop.type === 'Property' && !prop.computed && keyName(prop) === 'headers') {
      headersProp = prop
    }
  }
  if (!headersProp) return 'no-auth' // init object with no `headers` key

  const headersVal = headersProp.value
  if (headersVal.type !== 'ObjectExpression') return 'unknown' // headers: someVar

  for (const prop of headersVal.properties) {
    if (prop.type === 'SpreadElement') return 'unknown' // headers: { ...base } could carry it
    if (prop.type === 'Property' && !prop.computed) {
      const name = keyName(prop)
      if (name && name.toLowerCase() === 'authorization') return 'has-auth'
    } else if (prop.type === 'Property' && prop.computed) {
      return 'unknown' // headers: { [k]: v } — a computed key might be Authorization
    }
  }
  return 'no-auth' // headers object present, definitively no Authorization key
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow tokenless raw `fetch()` to internal `/api/...` routes. Use `apiFetch`/`apiFetchResponse` from @/lib/api so the Clerk bearer token is attached (the API authenticates only from the token; a session cookie is ignored).',
    },
    schema: [],
    messages: {
      raw:
        "Use `apiFetch` from @/lib/api instead of a bare `fetch('{{path}}')` — it attaches the Clerk bearer token. The API ignores the session cookie, so a tokenless call silently gets the slim/unauth response (see PR #1064). For a genuinely public endpoint use `apiFetch(path, { auth: false })` or add an eslint-disable with a reason.",
    },
  },
  create(context) {
    const filename = context.getFilename?.() ?? context.filename ?? ''
    if (isAllowedFile(filename)) return {}

    return {
      CallExpression(node) {
        if (!isFetchCallee(node.callee)) return
        const [urlArg, initArg] = node.arguments
        if (!isInternalApiPath(urlArg)) return
        if (authStatus(initArg) !== 'no-auth') return

        const path =
          urlArg.type === 'Literal'
            ? urlArg.value
            : `${urlArg.quasis?.[0]?.value?.cooked ?? ''}…`
        context.report({ node, messageId: 'raw', data: { path } })
      },
    }
  },
}
