/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: '#0b0f19',
        darkCard: 'rgba(15, 23, 42, 0.7)',
        accentBlue: '#00f2fe',
        accentIndigo: '#4facfe',
        neonCyan: '#06b6d4',
        neonPurple: '#d946ef',
        slateText: '#94a3b8'
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        neonCyan: '0 0 15px rgba(6, 182, 212, 0.5)',
        neonPurple: '0 0 15px rgba(217, 70, 239, 0.5)'
      },
      backdropBlur: {
        glass: '12px'
      }
    },
  },
  plugins: [],
}
