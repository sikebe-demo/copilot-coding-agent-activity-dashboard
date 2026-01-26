import type { Config } from 'tailwindcss'

export default {
  content: [
    "./index.html",
    "./app.ts",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config
