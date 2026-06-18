'use client'

import { useRef, useState } from 'react'
import { uploadCoverBackground, clearCoverBackground } from './coverBackground'

/**
 * Кнопка «загрузить/заменить фон» при одной обложке + «убрать».
 * Фон пишется в covers.background_url и показывается в превью обложки.
 */
export default function CoverBackgroundButton({
  coverId,
  hasBackground,
  onChanged,
}: {
  coverId: string
  hasBackground: boolean
  onChanged: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = (file: File | null) => {
    if (!file) return
    setBusy(true)
    setError(null)
    uploadCoverBackground(coverId, file)
      .then(() => onChanged())
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => {
        setBusy(false)
        if (inputRef.current) inputRef.current.value = ''
      })
  }

  const clear = () => {
    setBusy(true)
    setError(null)
    clearCoverBackground(coverId)
      .then(() => onChanged())
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-xs text-brand hover:underline disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Загрузка…' : hasBackground ? 'Заменить фон' : 'Загрузить фон'}
        </button>
        {hasBackground && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
            onClick={clear}
            disabled={busy}
          >
            убрать
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  )
}
