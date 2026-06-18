'use client'

import { useCallback, useEffect, useState } from 'react'
import CoverUploadModal from '../../covers/_components/CoverUploadModal'
import CoverBackgroundButton from '../../covers/_components/CoverBackgroundButton'

type CoverRow = {
  id: string
  name: string
  cover_type: 'portrait_photo' | 'common_photo' | 'design_only'
  gender_hint: 'neutral' | 'boys' | 'girls' | null
  is_published: boolean
  template_set_id: string | null
  background_url: string | null
  preview_svg: string
}

const TYPE_LABEL: Record<string, string> = {
  portrait_photo: 'Портрет ученика',
  common_photo: 'Общее фото',
  design_only: 'Дизайн без фото',
}

/**
 * Панель родных обложек дизайна (template_set): список + загрузка в дизайн +
 * фон при каждой обложке + публикация/удаление. Обложки видны только этому
 * дизайну (template_set_id заполнен, is_global=false).
 */
export default function CoverDesignPanel({ templateSetId }: { templateSetId: string }) {
  const [covers, setCovers] = useState<CoverRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/covers?action=list&template_set_id=${templateSetId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { covers: [] }))
      .then((d) => setCovers(d.covers ?? []))
      .catch(() => setError('Не удалось загрузить обложки'))
      .finally(() => setLoading(false))
  }, [templateSetId])

  useEffect(() => { load() }, [load])

  const setPublished = async (id: string, is_published: boolean) => {
    await fetch('/api/covers?action=set_published', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_published }),
    })
    load()
  }

  const remove = async (id: string) => {
    if (!confirm('Удалить эту обложку?')) return
    await fetch('/api/covers?action=delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    load()
  }

  return (
    <div className="mt-6 border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold">Обложки дизайна</h2>
          <p className="text-xs text-muted-foreground">
            Родные обложки этого дизайна. У каждой — свой фон.
          </p>
        </div>
        <button className="btn-primary text-sm" onClick={() => setShowUpload(true)}>
          + Загрузить обложку
        </button>
      </div>

      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}

      {loading ? (
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      ) : covers.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          Пока нет обложек. Загрузи IDML обложки (мастера на C-) — они привяжутся к этому дизайну.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {covers.map((c) => (
            <div key={c.id} className="border border-border rounded-lg p-2 flex flex-col gap-1">
              <div
                className="w-full bg-muted rounded overflow-hidden"
                style={{ aspectRatio: '3 / 2' }}
                dangerouslySetInnerHTML={{ __html: c.preview_svg }}
              />
              <div className="text-sm font-medium truncate" title={c.name}>{c.name}</div>
              <div className="text-xs text-muted-foreground">
                {TYPE_LABEL[c.cover_type] ?? c.cover_type}
                {c.gender_hint ? ` · ${c.gender_hint}` : ''}
                {c.background_url ? ' · фон есть' : ' · без фона'}
              </div>
              <CoverBackgroundButton coverId={c.id} hasBackground={!!c.background_url} onChanged={load} />
              <div className="flex items-center gap-2 text-xs mt-1">
                <button className="text-brand hover:underline" onClick={() => setPublished(c.id, !c.is_published)}>
                  {c.is_published ? 'снять с публикации' : 'опубликовать'}
                </button>
                <button className="text-red-600 hover:underline" onClick={() => remove(c.id)}>удалить</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && (
        <CoverUploadModal
          templateSetId={templateSetId}
          onClose={() => setShowUpload(false)}
          onSuccess={() => { setShowUpload(false); load() }}
        />
      )}
    </div>
  )
}
