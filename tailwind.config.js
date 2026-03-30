/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#1C1C1C',
        mist: '#F5F0E8',
        pop: '#5B9A72',
        orange: '#E05535',
        gold: '#F0B429',
      }
    },
  },
  plugins: [],
}
