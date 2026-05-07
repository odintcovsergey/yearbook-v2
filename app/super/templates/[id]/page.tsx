'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useParams } from 'next/navigation'
import type { TemplateSetDetailResponse, SpreadTemplate } from '../_components/types'
import { PLACEHOLDER_COLORS } from '../_components/colors'
import type { ConfigType, PrintType } from '@/lib/album-builder/types'

type BuildAlbumResult = {
  spreads: Array<{
    spread_index: number
    template_id: string
    template_name: string
    data: Record<string, string | null>
  }>
  warnings: Array<{ code: string; detail: string }>
  summary: {
    total_spreads: number
    total_warnings: number
    config_type: string
    print_type: string
    students_count: number
    subjects_count: number
  }
}

const CONFIG_TYPES: ConfigType[] = [
  'standard', 'universal', 'maximum', 'medium',
  'light', 'mini', 'individual',
]

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

type LoadError = { kind: 'notfound' | 'badrequest' | 'network'; message: string }

const SpreadCanvas = dynamic(
  () => import('../_components/SpreadCanvas'),
  { ssr: false, loading: () => <div className="text-gray-400 text-sm">Загрузка canvas…</div> },
)
const SpreadDetailModal = dynamic(
  () => import('../_components/SpreadDetailModal'),
  { ssr: false, loading: () => null },
)

export default function TemplateDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [authChecked, setAuthChecked] = useState(false)
  const [data, setData] = useState<TemplateSetDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<LoadError | null>(null)
  const [selectedSpread, setSelectedSpread] = useState<SpreadTemplate | null>(null)

  // ─── Build Test state ─────────────────────────────────────────
  const [buildOpen, setBuildOpen] = useState(false)
  const [buildLoading, setBuildLoading] = useState(false)
  const [buildResult, setBuildResult] = useState<BuildAlbumResult | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [bConfigType, setBConfigType] = useState<ConfigType>('standard')
  const [bPrintType, setBPrintType] = useState<PrintType>('layflat')
  const [bStudentsCount, setBStudentsCount] = useState(5)
  const [bSubjectsCount, setBSubjectsCount] = useState(0)
  const [bWithHeadTeacher, setBWithHeadTeacher] = useState(false)
  const [bFullClass, setBFullClass] = useState(0)
  const [bHalf, setBHalf] = useState(0)
  const [bFriendsPerStudent, setBFriendsPerStudent] = useState(0)

  const runBuildTest = useCallback(async () => {
    setBuildLoading(true)
    setBuildError(null)
    setBuildResult(null)
    try {
      const friendPhotos =
        bFriendsPerStudent > 0
          ? Array.from({ length: bStudentsCount }, () => bFriendsPerStudent)
          : []
      const r = await api('/api/layout?action=build_album_test', {
        method: 'POST',
        body: JSON.stringify({
          config_type: bConfigType,
          print_type: bPrintType,
          students_count: bStudentsCount,
          subjects_count: bSubjectsCount,
          with_head_teacher: bWithHeadTeacher,
          common_photos: { full_class: bFullClass, half: bHalf },
          friend_photos_per_student: friendPhotos,
        }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: 'unknown error' }))
        setBuildError(err.error ?? `HTTP ${r.status}`)
        return
      }
      setBuildResult((await r.json()) as BuildAlbumResult)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : 'network error')
    } finally {
      setBuildLoading(false)
    }
  }, [bConfigType, bPrintType, bStudentsCount, bSubjectsCount, bWithHeadTeacher, bFullClass, bHalf, bFriendsPerStudent])

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

  const loadDetail = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const r = await api(`/api/layout?action=template_set_detail&id=${id}`)
      if (r.status === 404) {
        setError({ kind: 'notfound', message: 'Шаблон не найден или нет доступа' })
        return
      }
      if (r.status === 400) {
        const d = await r.json().catch(() => ({}))
        setError({ kind: 'badrequest', message: d.error ?? 'Некорректный запрос' })
        return
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      setData((await r.json()) as TemplateSetDetailResponse)
    } catch (e) {
      setError({
        kind: 'network',
        message: e instanceof Error ? e.message : 'Ошибка сети',
      })
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (authChecked) loadDetail()
  }, [authChecked, loadDetail])

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
        <div className="mb-6">
          <button
            onClick={() => router.push('/super/templates')}
            className="btn-secondary mb-4"
          >
            ← К списку шаблонов
          </button>

          {data && (
            <>
              <h1 className="text-2xl font-semibold mb-1">{data.template_set.name}</h1>
              <p className="text-sm text-gray-500">
                <code>{data.template_set.slug}</code>
                {' · '}
                {Math.round(data.template_set.page_width_mm)} × {Math.round(data.template_set.page_height_mm)} mm
                {' · '}
                {data.spread_templates.length} разворотов
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-600">
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-3 h-3 rounded"
                    style={{ background: PLACEHOLDER_COLORS.photo.stroke }}
                  />
                  photo
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block w-3 h-3 rounded"
                    style={{ background: PLACEHOLDER_COLORS.text.stroke }}
                  />
                  text
                </span>
              </div>

              <div className="mt-4">
                <button
                  onClick={() => setBuildOpen((v) => !v)}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  {buildOpen ? '▲ Скрыть Build Test' : '▼ Build Test'}
                </button>

                {buildOpen && (
                  <div className="mt-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <h3 className="font-bold mb-3">Build Test — синтетический альбом</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <label className="flex items-center gap-2">
                        config_type:
                        <select
                          value={bConfigType}
                          onChange={(e) => setBConfigType(e.target.value as ConfigType)}
                          className="ml-auto px-2 py-1 border rounded"
                        >
                          {CONFIG_TYPES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-2">
                        print_type:
                        <select
                          value={bPrintType}
                          onChange={(e) => setBPrintType(e.target.value as PrintType)}
                          className="ml-auto px-2 py-1 border rounded"
                        >
                          <option value="layflat">layflat</option>
                          <option value="soft">soft</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2">
                        Учеников (0-100):
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={bStudentsCount}
                          onChange={(e) => setBStudentsCount(Number(e.target.value))}
                          className="ml-auto px-2 py-1 border rounded w-24"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        Предметников (0-30):
                        <input
                          type="number"
                          min={0}
                          max={30}
                          value={bSubjectsCount}
                          onChange={(e) => setBSubjectsCount(Number(e.target.value))}
                          className="ml-auto px-2 py-1 border rounded w-24"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={bWithHeadTeacher}
                          onChange={(e) => setBWithHeadTeacher(e.target.checked)}
                        />
                        head_teacher
                      </label>
                      <label className="flex items-center gap-2">
                        friend_photos на ученика (0-4):
                        <input
                          type="number"
                          min={0}
                          max={4}
                          value={bFriendsPerStudent}
                          onChange={(e) => setBFriendsPerStudent(Number(e.target.value))}
                          className="ml-auto px-2 py-1 border rounded w-20"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        full_class фото:
                        <input
                          type="number"
                          min={0}
                          max={5}
                          value={bFullClass}
                          onChange={(e) => setBFullClass(Number(e.target.value))}
                          className="ml-auto px-2 py-1 border rounded w-20"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        half фото:
                        <input
                          type="number"
                          min={0}
                          max={5}
                          value={bHalf}
                          onChange={(e) => setBHalf(Number(e.target.value))}
                          className="ml-auto px-2 py-1 border rounded w-20"
                        />
                      </label>
                    </div>

                    <button
                      onClick={runBuildTest}
                      disabled={buildLoading}
                      className="mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      {buildLoading ? 'Building…' : 'Build'}
                    </button>

                    {buildError && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                        Ошибка: {buildError}
                      </div>
                    )}

                    {buildResult && (
                      <div className="mt-4 space-y-3">
                        <div className="p-3 bg-white border border-gray-200 rounded text-sm">
                          <div className="font-bold mb-2">Сводка:</div>
                          <div>spreads: {buildResult.summary.total_spreads}</div>
                          <div>warnings: {buildResult.summary.total_warnings}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            {buildResult.summary.config_type} / {buildResult.summary.print_type}
                            {' · '}
                            students={buildResult.summary.students_count}
                            {' · '}
                            subjects={buildResult.summary.subjects_count}
                          </div>
                        </div>

                        {buildResult.warnings.length > 0 && (
                          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
                            <div className="font-bold mb-2">Warnings:</div>
                            {buildResult.warnings.map((w, i) => (
                              <div key={i} className="text-xs mb-1">
                                <span className="font-mono text-yellow-700">{w.code}</span>
                                {' — '}
                                {w.detail}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="p-3 bg-white border border-gray-200 rounded">
                          <div className="font-bold mb-2">Spreads:</div>
                          {buildResult.spreads.length === 0 && (
                            <div className="text-xs text-gray-500">Пусто</div>
                          )}
                          {buildResult.spreads.map((s) => (
                            <div key={s.spread_index} className="border-b border-gray-100 py-2 text-sm last:border-b-0">
                              <div>
                                <span className="font-mono text-gray-500">[{s.spread_index}]</span>{' '}
                                <span className="font-bold">{s.template_name}</span>
                              </div>
                              {Object.keys(s.data).length > 0 && (
                                <details className="mt-1 text-xs text-gray-600">
                                  <summary className="cursor-pointer">data ({Object.keys(s.data).length} ключей)</summary>
                                  <pre className="mt-1 p-2 bg-gray-50 rounded overflow-auto">
                                    {JSON.stringify(s.data, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {loading && (
          <div className="text-center py-12 text-gray-400">Загрузка…</div>
        )}

        {error && !loading && (
          <div className="card p-6 text-center">
            <div className="text-red-600 mb-3">{error.message}</div>
            {error.kind !== 'notfound' && (
              <button onClick={loadDetail} className="btn-secondary">Повторить</button>
            )}
          </div>
        )}

        {!loading && !error && data && data.spread_templates.length === 0 && (
          <div className="card p-12 text-center text-gray-500">
            В шаблоне нет ни одного разворота.
          </div>
        )}

        {!loading && !error && data && data.spread_templates.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {data.spread_templates.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedSpread(s)}
                className="card p-3 text-left hover:shadow-md transition-shadow"
              >
                <SpreadCanvas
                  spread={s}
                  containerWidth={250}
                  listening={false}
                  pixelRatio={1}
                  showLabels={false}
                />
                <div className="mt-2 text-xs">
                  <div className="text-gray-400 tabular-nums">{s.sort_order}.</div>
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-gray-500">
                    ({s.type})
                    {s.is_spread && ' · spread'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedSpread && (
        <SpreadDetailModal
          spread={selectedSpread}
          onClose={() => setSelectedSpread(null)}
        />
      )}
    </div>
  )
}
