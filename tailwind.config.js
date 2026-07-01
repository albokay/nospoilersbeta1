/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    // Ghost colors (ink/mist/pop/orange/gold) removed — they were defined here
    // but never used as utility classes anywhere; the app's palette lives in
    // src/styles/canon.ts. Nothing references the Tailwind color extension.
    extend: {},
  },
  plugins: [],
}
