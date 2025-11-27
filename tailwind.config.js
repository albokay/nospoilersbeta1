/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#111217',
        mist: '#f5f6f8',
        pop: '#5B9DFF'
      }
    },
  },
  plugins: [],
}
