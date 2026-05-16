/** @type {import('tailwindcss').Config} */
export default {
  // Dark mode is intentionally not enabled — there is no `.dark` token block
  // in index.css and no toggle UI. The previous `darkMode: ['class']` setting
  // was half-implemented (audit P2). When/if dark mode lands properly:
  //   1. Add a `.dark` block to index.css mirroring every `--*` token
  //   2. Add a toggle that sets `<html class="dark">`
  //   3. Re-enable `darkMode: ['class']` here
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: {
        lg:  '1100px',
        xl:  '1400px',
        '2xl': '1600px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Voice-fidelity semantic tokens — see src/index.css for HSL values.
        // The `<alpha-value>` placeholder enables opacity modifiers like
        // bg-contrast-signal/10, border-agreement-signal/30, etc.
        'verbatim-accent':  'hsl(var(--verbatim-accent) / <alpha-value>)',
        'agreement-signal': 'hsl(var(--agreement-signal) / <alpha-value>)',
        'contrast-signal':  'hsl(var(--contrast-signal) / <alpha-value>)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontSize: {
        // Extend Tailwind's scale with sub-xs sizes to replace text-[Npx]
        // arbitrary values. Use these instead of text-[10px] / text-[11px].
        //   text-3xs = 10px  (micro labels, badges, tags)
        //   text-2xs = 11px  (secondary labels, dense UI)
        '3xs': ['0.625rem', { lineHeight: '1rem' }],
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
}
