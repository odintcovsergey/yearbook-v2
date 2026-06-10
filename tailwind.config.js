/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}', './types/**/*.ts'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Семантические токены темы (значения в app/globals.css :root и .dark).
        // Тёмная тема включается классом .dark только в обёртке кабинета.
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: 'var(--card)',
        'card-foreground': 'var(--card-foreground)',
        muted: 'var(--muted)',
        'muted-foreground': 'var(--muted-foreground)',
        border: 'var(--border-color)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        // Мятная фирменная палитра OkeyBook (из логотипа). См. docs/design-guide-okeybook.md
        brand: {
          50: '#E1F5EE',   // очень светлый — подложки, hover-фоны
          100: '#99F6E4',  // светлый — мягкие фоны акцентных блоков
          200: '#7EE7D6',  // промежуточный (бордеры выделений)
          300: '#5EEAD4',  // hover-рамки карточек
          400: '#2DD4BF',  // акцент — подсветки, прогресс-бары, активные иконки
          500: '#14B8A6',  // насыщенный (точки статусов, средние акценты)
          600: '#0D9488',  // основной — кнопки, активные действия, ссылки
          700: '#0B7C72',  // тёмный — hover/active основного
          DEFAULT: '#0D9488',
        },
        // Тёплый светло-бежевый — подложка публичных/родительских экранов
        // (гармонирует с мятным; чтобы мятный не заливал весь фон).
        cream: {
          DEFAULT: '#F6F1E7',
          light: '#FCFAF4',
        },
      },
      boxShadow: {
        // Мягкие тени Pixieset
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
        modal: '0 10px 30px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
}
