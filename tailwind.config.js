/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ga: {
          50: '#f1f8f2',
          100: '#dcefe0',
          200: '#bce0c5',
          300: '#8ec89e',
          400: '#5da872',
          500: '#3f8a56',
          600: '#2f6f44',
          700: '#285939',
          800: '#23472f',
          900: '#1e3b29',
          950: '#0d2116'
        }
      },
      boxShadow: {
        soft: '0 14px 35px rgba(16, 24, 40, 0.08)'
      }
    }
  },
  plugins: []
};
