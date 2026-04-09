import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Выпускной альбом — выбор фотографий',
  description: 'Выберите фотографии для выпускного альбома',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
