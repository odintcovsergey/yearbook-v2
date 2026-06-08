'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { BookImage, AlertTriangle } from 'lucide-react'
import CoverUploadModal from './_components/CoverUploadModal'

type AuthData = {
  authenticated: boolean
  user?: { role: string }
  isLegacy?: boolean
}

type CoverRow = {
  id: string
  name: string
  slug: string | null
  cover_type: 'portrait_photo' | 'common_photo' | 'design_only'
  gender_hint: 'neutral' | 'boys' | 'girls' | null
  is_global: boolean
  is_published: boolean
  back_width_mm: number | null
  front_width_mm: number | null
  height_mm: number | null
  nominal_spine_width_mm: number | null
  preview_svg: string
}

const TYPE_LABEL: Record<CoverRow['cover_type'], string> = {
  portrait_photo: 'Портрет ученика',
  common_photo: 'Общее фото',
  design_only: 'Дизайн без фото',
}

const api = (path: string, opts?: RequestInit) =>
  fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })

export default function CoversPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [covers, setCovers] = useState<CoverRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    api('/api/auth')
      .then(r => r.ok ? r.json() : null)
      .then((d: AuthData | null) => {
        if (!d?.authenticated || d.isLegacy) { router.push('/login'); return }
        if (d.user?.role !== 'superadmin') { router.push('/app'); return }
        setAuthChecked(true)
      })
      .catch(() => router.push('/login'))
  }, [router])

  const loadCovers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api('/api/covers?action=list')
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      const d = await r.json()
      setCovers(d.covers ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить обложки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authChecked) loadCovers()
  }, [authChecked, loadCovers])

  const togglePublished = async (c: CoverRow) => {
    setBusyId(c.id)
    try {
      const r = await api('/api/covers?action=set_published', {
        method: 'POST',
        body: JSON.stringify({ id: c.id, is_published: !c.is_published }),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${r.status}`) }
      await loadCovers()
    } catch (e) {
      alert('Не удалось изменить публикацию: ' + (e instanceof Error ? e.message : ''))
    } finally {
      setBusyId(null)
    }
  }

  const deleteCover = async (c: CoverRow) => {
    if (!confirm(`Удалить обложку «${c.name}»? Действие необратимо.`)) return
    setBusyId(c.id)
    try {
      const r = await api('/api/covers?action=delete', {
        method: 'POST',
        body: JSON.stringify({ id: c.id }),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${r.status}`) }
      await loadCovers()
    } catch (e) {
      alert('Не удалось удалить: ' + (e instanceof Error ? e.message : ''))
    } finally {
      setBusyId(null)
    }
  }

  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Проверка авторизации…</div>
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2"><BookImage size={22} /> Библиотека обложек</h1>
            <p className="text-sm text-gray-500">
              Обложки альбома (полотно задняя + корешок + передняя). Корешок плавающий — пунктир показывает его границы.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/super')} className="btn-secondary">← К арендаторам</button>
            <button onClick={() => setShowUpload(true)} className="btn-primary">+ Загрузить обложку</button>
          </div>
        </div>

        {loading && <div className="text-center py-12 text-gray-400">Загрузка…</div>}

        {error && !loading && (
          <div className="card p-6 text-center">
            <div className="text-red-600 mb-3">{error}</div>
            <button onClick={loadCovers} className="btn-secondary">Повторить</button>
          </div>
        )}

        {!loading && !error && covers.length === 0 && (
          <div className="card p-12 text-center text-gray-500">
            <div className="mb-4">Обложек пока нет.</div>
            <button onClick={() => setShowUpload(true)} className="btn-primary">+ Загрузить первую обложку</button>
          </div>
        )}

        {!loading && !error && covers.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {covers.map(c => (
              <div key={c.id} className="card p-4">
                <div
                  className="w-full bg-gray-50 border border-gray-200 rounded mb-3 overflow-hidden flex items-center justify-center"
                  style={{ aspectRatio: '2 / 1' }}
                  dangerouslySetInnerHTML={{ __html: c.preview_svg }}
                />
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="font-medium text-sm truncate" title={c.name}>{c.name}</div>
                  {c.is_published
                    ? <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 shrink-0">опубл.</span>
                    : <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">черновик</span>}
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  {TYPE_LABEL[c.cover_type]}
                  {c.gender_hint ? ` · ${c.gender_hint}` : ''}
                  {c.is_global ? ' · глобальная' : ''}
                </div>
                <div className="text-xs text-gray-400 mb-3">
                  {c.nominal_spine_width_mm != null
                    ? `корешок (макет) ${c.nominal_spine_width_mm} мм`
                    : <><AlertTriangle size={12} className="inline" /> зоны не распознаны</>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => togglePublished(c)} disabled={busyId === c.id} className="btn-secondary text-xs flex-1">
                    {c.is_published ? 'Снять с публикации' : 'Опубликовать'}
                  </button>
                  <button onClick={() => deleteCover(c)} disabled={busyId === c.id}
                    className="px-3 py-1.5 text-xs rounded bg-red-50 hover:bg-red-100 text-red-600">
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showUpload && (
          <CoverUploadModal
            onClose={() => setShowUpload(false)}
            onSuccess={() => { setShowUpload(false); loadCovers() }}
          />
        )}
      </div>
    </div>
  )
}
