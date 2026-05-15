// Custom ESLint rule: ban `useMutation` from `@tanstack/react-query` outside
// of the one wrapper file that defines `useAppMutation`.
//
// Background. Every silent-button-fail bug in the recent triage (PRs #431,
// #436, #424, #427, #419) had the same shape: a TanStack mutation throws,
// the call site uses `.mutate()` (which swallows rejections unless an
// explicit onError is wired), and the user sees nothing. The
// `useAppMutation` wrapper (src/lib/useAppMutation.js) injects a default
// onError toast so failures are never silent.
//
// This rule keeps the wrapper from being bypassed. The only allowed direct
// import of `useMutation` is inside `useAppMutation.js` itself.

const ALLOWED_FILES = ['src/lib/useAppMutation.js']

function isAllowedFile(filename) {
  return ALLOWED_FILES.some((suffix) => filename.endsWith(suffix))
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct use of `useMutation` from @tanstack/react-query. Use `useAppMutation` from @/lib/useAppMutation instead — it adds a default error toast so failed mutations are never silent.',
    },
    schema: [],
    messages: {
      raw:
        'Use `useAppMutation` from @/lib/useAppMutation instead of bare `useMutation`. It adds a default error toast so failed mutations are never silent (see PRs #431, #436).',
    },
  },
  create(context) {
    const filename = context.getFilename?.() ?? context.filename ?? ''
    if (isAllowedFile(filename)) return {}

    // Track local names that resolve to @tanstack/react-query's useMutation
    // (handles `import { useMutation }` and `import { useMutation as foo }`).
    const localUseMutationNames = new Set()

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@tanstack/react-query') return
        for (const spec of node.specifiers) {
          if (
            spec.type === 'ImportSpecifier' &&
            spec.imported?.name === 'useMutation'
          ) {
            localUseMutationNames.add(spec.local.name)
            context.report({ node: spec, messageId: 'raw' })
          }
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          localUseMutationNames.has(node.callee.name)
        ) {
          context.report({ node: node.callee, messageId: 'raw' })
        }
      },
    }
  },
}
