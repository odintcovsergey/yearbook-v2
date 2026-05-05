'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import TemplateSetCard from './_components/TemplateSetCard'
import UploadModal from './_components/UploadModal'
import type { TemplateSet } from './_components/types'

type AuthData = {
  authenticated: boolean
  user?: { id: string; email: string; full_name: string; role: string }
  isLegacy?: boolean
}

// PostgREST nested-aggregate: GET возвращает spread_templates: [{ count }].
// Маппим в spread_count для UI.
type TemplateSetRaw = Omit<TemplateSet, 'spread_count'> & {
  spread_templates: { count: number }[]
}

const api = (path: string, opts?: RequestInit) =>
  fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })

export default function TemplatesPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [templates, setTemplates] = useState<TemplateSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

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

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api('/api/layout?action=template_sets')
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      const raw = (await r.json()) as TemplateSetRaw[]
      const enriched: TemplateSet[] = raw.map(({ spread_templates, ...rest }) => ({
        ...rest,
        spread_count: spread_templates?.[0]?.count ?? 0,
      }))
      setTemplates(enriched)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить шаблоны')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authChecked) loadTemplates()
  }, [authChecked, loadTemplates])

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Проверка авторизации…
      </div>
    )
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold mb-1">📐 Шаблоны вёрстки</h1>
            <p className="text-sm text-gray-500">
              Наборы master-разворотов для построения альбомов
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/super')} className="btn-secondary">
              ← К арендаторам
            </button>
            <button onClick={() => setShowUpload(true)} className="btn-primary">
              + Загрузить IDML
            </button>
          </div>
        </div>

        {loading && (
          <div className="text-center py-12 text-gray-400">Загрузка…</div>
        )}

        {error && !loading && (
          <div className="card p-6 text-center">
            <div className="text-red-600 mb-3">{error}</div>
            <button onClick={loadTemplates} className="btn-secondary">Повторить</button>
          </div>
        )}

        {!loading && !error && templates.length === 0 && (
          <div className="card p-12 text-center text-gray-500">
            <div className="mb-4">Шаблоны не загружены.</div>
            <button onClick={() => setShowUpload(true)} className="btn-primary">
              + Загрузить первый IDML
            </button>
          </div>
        )}

        {!loading && !error && templates.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(t => (
              <TemplateSetCard
                key={t.id}
                template={t}
                onOpen={() => router.push(`/super/templates/${t.id}`)}
              />
            ))}
          </div>
        )}

        {showUpload && (
          <UploadModal
            onClose={() => setShowUpload(false)}
            onSuccess={() => { setShowUpload(false); loadTemplates() }}
          />
        )}
      </div>
    </div>
  )
}
