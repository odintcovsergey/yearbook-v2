'use client'

import { uploadViaSignedTarget } from '@/lib/blob-upload-client'

// Фон обложки заказа — тот же публичный bucket, что у фонов внутрянки и
// эталонных обложек. Загруженный фон НЕ трогает эталон в библиотеке: его URL
// сохраняется поверх в cover_edits.__bg__ (шаблонно или поштучно).
const BUCKET = 'template-backgrounds'

/**
 * Загружает новый фон обложки в заказ: sign → прямой PUT в storage → возвращает
 * публичный URL для сохранения в `__bg__`. Файл идёт мимо нашего сервера, лимит
 * тела Vercel (HTTP 413) не действует. Бросает Error с человекочитаемым текстом.
 */
export async function uploadAlbumCoverBackground(albumId: string, file: File): Promise<string> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    throw new Error('Допустимы только JPG и PNG')
  }
  const ext = file.type === 'image/png' ? 'png' : 'jpg'

  const signRes = await fetch('/api/tenant', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cover_bg_sign', album_id: albumId, ext }),
  })
  const sign = await signRes.json().catch(() => ({}))
  if (!signRes.ok || !sign.public_url) {
    throw new Error(sign.error || `Ошибка подписи (HTTP ${signRes.status})`)
  }

  await uploadViaSignedTarget(BUCKET, sign, file)

  return sign.public_url as string
}
