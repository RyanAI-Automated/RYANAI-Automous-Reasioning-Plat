/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sovereign: {
          dark: '#020617',    // bg-sovereign-dark, text-sovereign-dark
          primary: '#3b82f6', // bg-sovereign-primary, border-sovereign-primary
          accent: '#10b981',  // bg-sovereign-accent, text-sovereign-accent
          panel: '#1e293b',   // bg-sovereign-panel
        }
      },
      fontFamily: {
        sans: ["Space Grotesk", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
        orbitron: ["Orbitron", "sans-serif"],
      },
    },
  },
  plugins: [],
}