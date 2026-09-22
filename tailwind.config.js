/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // ── Brand blue ────────────────────────────────────────────────────
      // royal.500 is the single source of truth for the corporate blue.
      // Currently Standard Blue #032FAA (per the brand pack).
      // The logo artwork itself samples as #0139B0 — if the brand pack is not
      // authoritative, change royal.500 below and the whole app follows.
      colors: {
        // Good & General masterbrand palette (Brand Pack v2.0)
        royal: {
          50:  '#F2F6FF',
          100: '#D4EFFF', // Open Sky
          200: '#B8D8F7',
          300: '#86B6EE',
          400: '#4D79D9',
          // Brand blue. The supplied logo artwork samples as #0139B0; the brand
          // pack value below is what the UI uses. Change this one line to switch.
          500: '#032FAA', // Standard Blue
          600: '#02288F',
          700: '#062574',
          800: '#0A215B',
          900: '#0B1B33',
        },
        sky:   '#D4EFFF',
        paper: '#F7F6F2',
        coral: '#F05A47',
        lime:  '#C8EF3F',
        ink:   '#0B1B33',
        muted: '#5F6D82',
        rule:  '#DDE1E7',
        // Functional colours are intentionally quieter than the brand accents.
        gain:  '#167A55',
        loss:  '#C94738',
        warn:  '#956400',
      },
      fontFamily: {
        sans: ['Figtree', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Figtree', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,27,51,0.04)',
        lift: '0 8px 30px -18px rgba(11,27,51,0.28)',
        modal: '0 28px 80px -28px rgba(11,27,51,0.42)',
      },
      borderRadius: {
        card: '6px',
      },
    },
  },
  plugins: [],
}
