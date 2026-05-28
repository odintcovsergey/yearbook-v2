'use client'

import { useRef, useState } from 'react'

type Props = {
  templateSetId: string
  currentPath: string | null
  onChange: (newPath: string | null) => void
}

const BUCKET = 'template-backgrounds'
const MAX_SIZE_MB = 50
const ACCEPT = 'image/jpeg,image/png'

function buildPublicUrl(path: string): string {
  // Cache-busting через timestamp, чтобы UI сразу видел новый файл
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}?t=${Date.now()}`
}

export default function TemplateBackgroundPanel({ templateSetId, currentPath, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewKey, setPreviewKey] = useState(0)

  const previewUrl = currentPath ? buildPublicUrl(currentPath) : null

  const handleFile = async (file: File) => {
    setError(null)

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Допустимы только JPG и PNG')
      return
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`Файл больше ${MAX_SIZE_MB} МБ`)
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const r = await fetch(`/api/super/template-sets/${templateSetId}/background`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const data = await r.json()
      if (!r.ok) {
        setError(data.error ?? `Ошибка загрузки (HTTP ${r.status})`)
        return
      }
      onChange(data.default_background_url)
      setPreviewKey(k => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Сетевая ошибка')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async () => {
    if (!currentPath) return
    if (!confirm('Удалить фоновое изображение набора?')) return

    setError(null)
    setDeleting(true)
    try {
      const r = await fetch(`/api/super/template-sets/${templateSetId}/background`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(data.error ?? `Ошибка удаления (HTTP ${r.status})`)
        return
      }
      onChange(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Сетевая ошибка')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          {previewUrl ? (
            <img
              key={previewKey}
              src={previewUrl}
              alt="Фоновое изображение набора"
              className="block w-48 h-32 object-contain bg-white border border-gray-300 rounded"
            />
          ) : (
            <div className="w-48 h-32 flex items-center justify-center bg-white border border-dashed border-gray-300 rounded text-xs text-gray-400">
              Фон не задан
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm mb-1">Фоновое изображение набора</h3>
          <p className="text-xs text-gray-500 mb-3">
            JPG или PNG до {MAX_SIZE_MB} МБ. Один файл применяется как подложка
            ко всем разворотам альбома, использующего этот набор.
            Размер картинки должен соответствовать размеру разворота.
          </p>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || deleting}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? 'Загружаю…' : (currentPath ? 'Заменить' : 'Загрузить')}
            </button>

            {currentPath && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={uploading || deleting}
                className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-100 disabled:opacity-50"
              >
                {deleting ? 'Удаляю…' : 'Удалить'}
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />

          {error && (
            <div className="mt-2 text-sm text-red-600">{error}</div>
          )}

          {currentPath && !error && (
            <div className="mt-2 text-xs text-gray-400 font-mono break-all">
              {currentPath}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
