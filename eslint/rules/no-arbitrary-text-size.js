// ESLint rule: ban text-[Npx] arbitrary Tailwind font-size utilities.
// Use text-3xs (10px), text-2xs (11px), or the standard Tailwind scale instead.
// See tailwind.config.js for the full size token definitions.

const PATTERN = /\btext-\[\d+(?:\.\d+)?px\]/

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow text-[Npx] arbitrary Tailwind font-size utilities',
    },
    messages: {
      noArbitraryTextSize:
        'Use text-3xs (10px), text-2xs (11px), or the Tailwind scale instead of "{{ value }}".',
    },
    schema: [],
  },

  create(context) {
    function check(node, value) {
      if (typeof value !== 'string') return
      const matches = value.match(/text-\[\d+(?:\.\d+)?px\]/g)
      if (!matches) return
      for (const match of matches) {
        context.report({
          node,
          messageId: 'noArbitraryTextSize',
          data: { value: match },
        })
      }
    }

    return {
      JSXAttribute(node) {
        if (node.name?.name !== 'className') return
        const val = node.value
        if (!val) return
        if (val.type === 'Literal') {
          check(node, val.value)
        } else if (val.type === 'JSXExpressionContainer') {
          const expr = val.expression
          if (expr.type === 'Literal') check(node, expr.value)
          // Template literals — check each quasi
          if (expr.type === 'TemplateLiteral') {
            for (const q of expr.quasis) {
              check(node, q.value.cooked || q.value.raw)
            }
          }
        }
      },
      // Also catch className in plain JS strings (e.g. clsx/cn calls)
      Literal(node) {
        if (typeof node.value !== 'string') return
        if (!PATTERN.test(node.value)) return
        // Only flag if the literal looks like a Tailwind class string
        if (!node.value.includes('text-[')) return
        check(node, node.value)
      },
    }
  },
}
