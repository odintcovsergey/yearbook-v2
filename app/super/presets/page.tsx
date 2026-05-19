'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import PresetEditorModal, { type Preset } from './_components/PresetEditorModal'

type AuthData = {
  authenticated: boolean
  user?: { id: string; email: string; full_name: string; role: string }
  isLegacy?: boolean
}

const api = (path: string, opts?: RequestInit) =>
  fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })

export default function PresetsPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [presets, setPresets] = useState<Preset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Preset | null>(null)

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

  const loadPresets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api('/api/tenant?action=rule_presets_list')
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      const data = await r.json()
      setPresets(data.presets ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authChecked) loadPresets()
  }, [authChecked, loadPresets])

  if (!authChecked) return null

  // Группируем: глобальные / тенантовские
  const globalPresets = presets.filter(p => p.tenant_id === null)
  const tenantPresets = presets.filter(p => p.tenant_id !== null)

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Пресеты вёрстки</h1>
            <p className="text-sm text-gray-600 mt-1">
              Редактор структуры альбома. Каждый пресет описывает порядок секций,
              плотность портретов и параметры личного раздела.
            </p>
          </div>
          <button
            onClick={() => router.push('/super')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← К панели
          </button>
        </div>

        {loading && <div className="text-gray-500">Загрузка...</div>}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-3">
                Глобальные пресеты ({globalPresets.length})
              </h2>
              <p className="text-xs text-gray-500 mb-3">
                Доступны всем партнёрам по умолчанию. Редактирует только суперадмин.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {globalPresets.map(p => (
                  <PresetCard
                    key={p.id}
                    preset={p}
                    onEdit={() => setEditing(p)}
                  />
                ))}
              </div>
            </section>

            {tenantPresets.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-3">
                  Партнёрские пресеты ({tenantPresets.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {tenantPresets.map(p => (
                    <PresetCard
                      key={p.id}
                      preset={p}
                      onEdit={() => setEditing(p)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {editing && (
          <PresetEditorModal
            preset={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              loadPresets()
            }}
          />
        )}
      </div>
    </div>
  )
}

// ─── Карточка пресета ────────────────────────────────────────────────────

function PresetCard({ preset, onEdit }: { preset: Preset; onEdit: () => void }) {
  const sections = Array.isArray(preset.section_structure)
    ? preset.section_structure
    : []

  return (
    <div className="bg-white border rounded-lg p-4 hover:border-purple-300 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 truncate">
            {preset.display_name}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 font-mono">
            {preset.id}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {preset.density && (
              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                {preset.density}
              </span>
            )}
            {preset.sheet_type && (
              <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                {preset.sheet_type === 'hard' ? 'плотные' : 'мягкие'}
              </span>
            )}
            {preset.min_pages != null && preset.max_pages != null && (
              <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                {preset.min_pages}–{preset.max_pages} стр.
              </span>
            )}
          </div>
          <div className="text-xs text-gray-600 mt-2">
            {sections.length > 0 ? (
              <span>
                Секций: <span className="font-semibold">{sections.length}</span>
                {' — '}
                {sections.map(s => s.type).join(' → ')}
              </span>
            ) : (
              <span className="text-amber-600">section_structure пустой</span>
            )}
          </div>
        </div>
        <button
          onClick={onEdit}
          className="text-sm bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded whitespace-nowrap"
        >
          Редактировать
        </button>
      </div>
    </div>
  )
}
