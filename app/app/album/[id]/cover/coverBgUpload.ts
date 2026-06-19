'use client'

import { supabaseBrowser } from '@/lib/supabase-browser'

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
  if (!signRes.ok || !sign.path || !sign.token || !sign.public_url) {
    throw new Error(sign.error || `Ошибка подписи (HTTP ${signRes.status})`)
  }

  const { error: upErr } = await supabaseBrowser.storage
    .from(BUCKET)
    .uploadToSignedUrl(sign.path, sign.token, file, { contentType: file.type })
  if (upErr) throw new Error(upErr.message)

  return sign.public_url as string
}
