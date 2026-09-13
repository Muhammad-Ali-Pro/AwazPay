/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        midnight: {
          950: '#05050a',
          900: '#0a0a12',
          800: '#12121d',
          700: '#1a1a29',
          600: '#242438',
        },
        // Sampled directly from the AwazPay logo mark (blue head silhouette -> green NFC icon).
        violet: {
          DEFAULT: '#0A6EC7',
          light: '#4FA8F5',
          dim: '#073F73',
        },
        cyan: {
          DEFAULT: '#00C896',
          light: '#6EEFC9',
        },
        navy: '#01244D',
        success: {
          DEFAULT: '#3ddc97',
        },
        danger: {
          DEFAULT: '#ff6b7a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        orb: '0 0 80px -10px rgba(10, 110, 199, 0.55)',
        'orb-cyan': '0 0 80px -10px rgba(0, 200, 150, 0.55)',
        glow: '0 0 0 1px rgba(255,255,255,0.06), 0 8px 30px rgba(0,0,0,0.4)',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.9' },
          '50%': { transform: 'scale(1.06)', opacity: '1' },
        },
        'ring-pulse': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.4)', opacity: '0' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        breathe: 'breathe 3.2s ease-in-out infinite',
        'ring-pulse': 'ring-pulse 2s ease-out infinite',
        'spin-slow': 'spin-slow 3s linear infinite',
      },
    },
  },
  plugins: [],
}
