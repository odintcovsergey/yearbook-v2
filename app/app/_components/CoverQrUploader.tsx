'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Загрузка QR-кода для задней обложки заказа (слот back_qr). Картинка хранится
 * в albums.cover_qr_url; авто-подставляется в обложку при сборке/превью.
 */
export default function CoverQrUploader({
  albumId, initialPath,
}: {
  albumId: string
  initialPath: string | null
}) {
  // Начальное превью: запрашиваем подписанную (Timeweb-aware) ссылку у сервера,
  // а не клеим публичный Supabase-URL руками (после переезда он битый).
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!initialPath) return
    let alive = true
    fetch(`/api/tenant?action=sign_cover_qr&album_id=${albumId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.url) setUrl(d.url) })
      .catch(() => {})
    return () => { alive = false }
  }, [albumId, initialPath])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = (file: File | null) => {
    if (!file) return
    setBusy(true); setError(null)
    const fd = new FormData()
    fd.append('action', 'upload_cover_qr')
    fd.append('album_id', albumId)
    fd.append('file', file)
    fetch('/api/tenant', { method: 'POST', credentials: 'include', body: fd })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d })
      .then((d) => setUrl(d.public_url ?? null))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => { setBusy(false); if (inputRef.current) inputRef.current.value = '' })
  }

  const clear = () => {
    setBusy(true); setError(null)
    fetch('/api/tenant', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear_cover_qr', album_id: albumId }) })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`) })
      .then(() => setUrl(null))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="mt-3">
      <label className="block text-xs text-muted-foreground mb-1">QR-код для задней обложки (необязательно)</label>
      <div className="flex items-center gap-2">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="QR" className="w-12 h-12 object-contain rounded border border-border bg-white" />
        )}
        <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Загрузка…' : url ? 'Заменить QR' : 'Загрузить QR'}
        </button>
        {url && <button type="button" className="text-xs text-red-600 hover:underline" disabled={busy} onClick={clear}>убрать</button>}
        <input ref={inputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => upload(e.target.files?.[0] ?? null)} />
      </div>
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
    </div>
  )
}
