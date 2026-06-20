'use client'

import { uploadViaSignedTarget } from '@/lib/blob-upload-client'

// Фон обложки — тот же публичный bucket, что у фонов внутрянки.
const BUCKET = 'template-backgrounds'

/**
 * Загружает фон при обложке: sign → прямой PUT в storage → commit
 * (covers.background_url). Файл идёт мимо нашего сервера, лимит тела Vercel
 * не действует. Бросает Error с человекочитаемым сообщением.
 */
export async function uploadCoverBackground(coverId: string, file: File): Promise<void> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    throw new Error('Допустимы только JPG и PNG')
  }
  const ext = file.type === 'image/png' ? 'png' : 'jpg'

  const signRes = await fetch('/api/covers?action=bg_sign', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: coverId, ext }),
  })
  const sign = await signRes.json().catch(() => ({}))
  if (!signRes.ok) {
    throw new Error(sign.error || `Ошибка подписи (HTTP ${signRes.status})`)
  }

  await uploadViaSignedTarget(BUCKET, sign, file)

  const commitRes = await fetch('/api/covers?action=bg_commit', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: coverId, path: sign.path }),
  })
  const commit = await commitRes.json().catch(() => ({}))
  if (!commitRes.ok) {
    throw new Error(commit.error || `Ошибка сохранения (HTTP ${commitRes.status})`)
  }
}

/** Снимает фон у обложки. */
export async function clearCoverBackground(coverId: string): Promise<void> {
  const r = await fetch('/api/covers?action=bg_clear', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: coverId }),
  })
  if (!r.ok) {
    const d = await r.json().catch(() => ({}))
    throw new Error(d.error || `HTTP ${r.status}`)
  }
}
