// Custom ESLint rule: enforce Vercel runtime ↔ handler shape match for api/*
// handlers.
//
// Background. A Node-runtime Vercel function whose handler returns
// `new Response(...)` does NOT crash — Vercel silently discards the return
// value and the function hangs until `maxDuration` expires (default 300s),
// surfacing client-side as a spinning request that eventually 504s. The
// same shape applies in reverse for Edge handlers that try to call
// `res.status().json()`. Three prod regressions (#293, #312, #331) traced
// back to this exact class of mismatch.
//
// What we enforce per file:
//   - Require explicit `export const config = { runtime: 'nodejs' | 'edge' }`.
//     Missing declaration → error. Implicit defaults are banned so future
//     Vercel platform changes don't silently flip functions to the wrong runtime.
//   - Determine runtime from `export const config = { runtime: ... }`.
//     Absent / unset → Node (permissive fallback for legacy; explicit decl still required).
//   - Find the handler. We treat any of these as the handler body:
//       function handler(req, res) {...}
//       const handler = (req, res) => {...}
//       export default async function handler(req, res) {...}
//       export default async function (req, res) {...}
//   - Node handlers must NOT contain:
//       return new Response(...)       (silently hangs to maxDuration)
//       await req.json(...)            (req.body is pre-parsed)
//       req.headers.get(...)           (req.headers is a plain object)
//   - Edge handlers must NOT reference `res.` (only req exists).
//
// The rule is scoped via eslint.config.js to api/**/*.js, excluding
// api/_lib/**. Helpers and non-handler files are left alone.

const MISSING_RUNTIME_MESSAGE =
  "Vercel handler is missing an explicit runtime declaration. Add `export const config = { runtime: 'nodejs' }` (or 'edge') as the second line of this file. Implicit defaults are banned — see CLAUDE.md \"API handler runtime conventions.\""

const NODE_MESSAGES = {
  newResponse:
    'Node-runtime handler must not return `new Response(...)` — Vercel silently discards the return value and the function hangs to maxDuration. Use res.status().json() / res.write() / res.end() instead. See CLAUDE.md "API handler runtime conventions."',
  reqJson:
    'Node-runtime handler must not call `await req.json()` — req.body is already parsed JSON. See CLAUDE.md "API handler runtime conventions."',
  headersGet:
    "Node-runtime handler must not call `req.headers.get(...)` — req.headers is a plain lowercased object; use req.headers['x-foo']. See CLAUDE.md \"API handler runtime conventions.\"",
}

const EDGE_MESSAGES = {
  resReference:
    'Edge-runtime handler must not reference `res` — Edge handlers receive only `req` and must `return new Response(...)`. See CLAUDE.md "API handler runtime conventions."',
}

function readRuntime(programBody) {
  for (const node of programBody) {
    if (
      node.type !== 'ExportNamedDeclaration' ||
      node.declaration?.type !== 'VariableDeclaration'
    ) {
      continue
    }
    for (const decl of node.declaration.declarations) {
      if (decl.id?.name !== 'config' || decl.init?.type !== 'ObjectExpression') continue
      for (const prop of decl.init.properties) {
        if (prop.type !== 'Property') continue
        const key = prop.key?.name ?? prop.key?.value
        if (key !== 'runtime') continue
        const val = prop.value?.value
        if (val === 'edge') return { runtime: 'edge', explicit: true }
        if (val === 'nodejs') return { runtime: 'nodejs', explicit: true }
      }
    }
  }
  return { runtime: 'nodejs', explicit: false }
}

function collectHandlerFunctions(programBody) {
  const handlers = new Set()
  for (const node of programBody) {
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'handler') {
      handlers.add(node)
    }
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (
          decl.id?.name === 'handler' &&
          decl.init &&
          (decl.init.type === 'ArrowFunctionExpression' ||
            decl.init.type === 'FunctionExpression')
        ) {
          handlers.add(decl.init)
        }
      }
    }
    if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration
      if (
        decl?.type === 'FunctionDeclaration' ||
        decl?.type === 'ArrowFunctionExpression' ||
        decl?.type === 'FunctionExpression'
      ) {
        handlers.add(decl)
      }
    }
  }
  return handlers
}

function isInside(node, fnSet) {
  let cur = node
  while (cur) {
    if (fnSet.has(cur)) return true
    cur = cur.parent
  }
  return false
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Block Vercel runtime ↔ handler shape mismatches in api/* (Node handlers returning new Response, Edge handlers touching res, etc.)',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode()
    const program = sourceCode.ast
    const { runtime, explicit } = readRuntime(program.body)
    const handlerFns = collectHandlerFunctions(program.body)
    if (handlerFns.size === 0) return {}

    return {
      'Program:exit'(node) {
        if (!explicit) {
          context.report({ node, message: MISSING_RUNTIME_MESSAGE })
        }
      },
      NewExpression(node) {
        if (runtime !== 'nodejs') return
        if (node.callee?.type !== 'Identifier' || node.callee.name !== 'Response') return
        // Only flag two-param (req, res) Node handlers. Single-param handlers
        // (middleware, Edge-style) legitimately return new Response().
        const enclosing = [...handlerFns].find((fn) => isInside(node, new Set([fn])))
        if (!enclosing || (enclosing.params?.length ?? 0) < 2) return
        context.report({ node, message: NODE_MESSAGES.newResponse })
      },
      CallExpression(node) {
        if (runtime !== 'nodejs') return
        const callee = node.callee
        if (callee?.type !== 'MemberExpression') return
        const obj = callee.object
        const prop = callee.property?.name

        if (obj?.type === 'Identifier' && obj.name === 'req' && prop === 'json') {
          if (isInside(node, handlerFns)) {
            context.report({ node, message: NODE_MESSAGES.reqJson })
          }
          return
        }

        if (
          obj?.type === 'MemberExpression' &&
          obj.object?.type === 'Identifier' &&
          obj.object.name === 'req' &&
          obj.property?.name === 'headers' &&
          prop === 'get'
        ) {
          if (isInside(node, handlerFns)) {
            context.report({ node, message: NODE_MESSAGES.headersGet })
          }
        }
      },
      MemberExpression(node) {
        if (runtime !== 'edge') return
        if (node.object?.type !== 'Identifier' || node.object.name !== 'res') return
        if (!isInside(node, handlerFns)) return
        context.report({ node, message: EDGE_MESSAGES.resReference })
      },
    }
  },
}
