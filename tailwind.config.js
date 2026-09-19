/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Taken from the Good & General wordmark
        royal: {
          50:  '#EEF3FC',
          100: '#DAE5F9',
          200: '#B4CAF3',
          300: '#7FA4E8',
          400: '#3C6FD6',
          500: '#0139B0',
          600: '#012E8F',
          700: '#01246F',
          800: '#011A52',
          900: '#0B1B33',
        },
        ink:   '#0B1B33',
        paper: '#F4F6FA',
        rule:  '#DCE3EF',
        gain:  '#0F7B4F',
        loss:  '#B3261E',
        warn:  '#8A5D00',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Archivo', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,27,51,0.04)',
        lift: '0 4px 16px -4px rgba(11,27,51,0.12)',
        modal: '0 24px 60px -12px rgba(11,27,51,0.30)',
      },
      borderRadius: {
        card: '10px',
      },
    },
  },
  plugins: [],
}
