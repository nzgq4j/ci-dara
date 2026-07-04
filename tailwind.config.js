const { fontFamily } = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    'app/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'pages/**/*.{ts,tsx}'
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px'
      }
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', ...fontFamily.sans],
        mono: ['var(--font-mono)', ...fontFamily.mono]
      },
      colors: {
        // Semantic theme tokens — resolve to CSS vars in styles/main.css so the
        // whole UI flips with [data-theme]. RGB-channel form keeps Tailwind
        // opacity modifiers (e.g. border-line/50) working.
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        surf: 'rgb(var(--c-surf) / <alpha-value>)',
        surf2: 'rgb(var(--c-surf2) / <alpha-value>)',
        surf3: 'rgb(var(--c-surf3) / <alpha-value>)',
        line: 'rgb(var(--c-border) / <alpha-value>)',
        t1: 'rgb(var(--c-t1) / <alpha-value>)',
        t2: 'rgb(var(--c-t2) / <alpha-value>)',
        t3: 'rgb(var(--c-t3) / <alpha-value>)',
        t4: 'rgb(var(--c-t4) / <alpha-value>)',
        t5: 'rgb(var(--c-t5) / <alpha-value>)',
        navy: 'rgb(var(--c-navy) / <alpha-value>)',
        gold: 'rgb(var(--c-gold) / <alpha-value>)'
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
};
