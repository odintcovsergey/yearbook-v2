'use client'

/**
 * ExportPanel — UI компонент для PDF-экспорта (фаза 3.7).
 *
 * Размещается в Обзоре альбома (AlbumDetailModal), под LayoutPreviewStrip.
 * Виден только если layout альбома собран (caller проверяет layout перед
 * монтированием).
 *
 * UI:
 *   - Dropdown «Профиль экспорта» (3 seed: print / preview / per-student-stub)
 *   - Описание выбранного профиля (info-строка про размер/dpi/bleed)
 *   - Кнопка «Экспортировать PDF»
 *   - Прогресс при экспорте (spinner + текст), sync request 30-60 сек
 *   - После успеха: file_size, page_count, warnings, кнопка «Скачать»
 *   - История последних 10 экспортов с download-кнопками
 *
 * Связь со спекой: docs/phase-3-spec.md §4.6.
 */

import { useEffect, useState, useMemo, useCallback } from 'react'
import { api } from '@/lib/api-client'

// ─── Типы (зеркало серверных ответов) ────────────────────────────────────

type ExportProfile = {
  id: string
  slug: string
  name: string
  is_default: boolean
  purpose: 'typography' | 'preview'
  format: 'pdf' | 'jpg-pages'
  quality: 'high' | 'medium' | 'preview'
  include_bleed: boolean
  dpi: number
  pages_mode: 'all_common' | 'per_student' | 'per_student_individual_only'
  target_size_mb: number | null
  spread_export: boolean
}

type AlbumExport = {
  id: string
  filename: string
  storage_path: string
  file_size: number
  page_count: number
  warnings: { code: string; detail: string }[] | null
  created_at: string
  expires_at: string
  download_url: string
  export_profiles: { slug: string; name: string; format: string; purpose: string } | null
}

type ExportResponse = {
  export_id: string
  download_url: string
  filename: string
  file_size: number
  page_count: number
  warnings: { code: string; detail: string }[]
}

type ExportError = {
  error: string
  code?: string
}

// Ответ типографской выгрузки (zip по книгам под профиль типографии заказа).
type TypographyResponse = {
  download_url: string
  filename: string
  file_count: number
  total_spreads: number
  has_personal: boolean
  accept_mode: 'spread' | 'page'
  adapt_status: 'native' | 'adapted' | 'incompatible'
  adapt_warning?: string
  warnings: { code: string; detail: string }[]
}

type Props = {
  albumId: string
  hasLayout: boolean // true если album_layouts.spreads.length > 0
  viewAsTenantId?: string
}

// ─── API хелперы ─────────────────────────────────────────────────────────

function buildUrl(base: string, viewAsTenantId?: string): string {
  if (!viewAsTenantId) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}view_as=${viewAsTenantId}`
}

async function apiGet<T>(url: string): Promise<T> {
  const r = await api(url)
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`${r.status}: ${text}`)
  }
  return r.json()
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const r = await api(url, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    let errBody: ExportError
    try {
      errBody = await r.json()
    } catch {
      throw new Error(`${r.status}: ошибка сервера`)
    }
    const err = new Error(errBody.error ?? 'Неизвестная ошибка') as Error & { code?: string }
    err.code = errBody.code
    throw err
  }
  return r.json()
}

// ─── Format helpers ──────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function profileDescription(p: ExportProfile): string {
  const parts: string[] = []
  if (p.target_size_mb) parts.push(`~${p.target_size_mb} МБ`)
  parts.push(`${p.dpi} dpi`)
  if (p.include_bleed) parts.push('с обрезной зоной')
  else parts.push('без обрезной зоны')
  parts.push(p.spread_export ? 'разворотами' : 'постранично')
  if (p.pages_mode === 'per_student') parts.push('индивидуальные комплекты')
  return parts.join(' · ')
}

// ─── Компонент ───────────────────────────────────────────────────────────

export default function ExportPanel({ albumId, hasLayout, viewAsTenantId }: Props) {
  const [profiles, setProfiles] = useState<ExportProfile[]>([])
  const [exports, setExports] = useState<AlbumExport[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string>('')
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [lastResult, setLastResult] = useState<ExportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Типографская выгрузка (zip) — отдельное состояние.
  const [exportingZip, setExportingZip] = useState(false)
  const [zipResult, setZipResult] = useState<TypographyResponse | null>(null)
  const [zipError, setZipError] = useState<string | null>(null)

  // Загружаем профили при mount (один раз)
  useEffect(() => {
    let cancelled = false
    apiGet<{ profiles: ExportProfile[] }>('/api/layout?action=list_export_profiles')
      .then((d) => {
        if (cancelled) return
        setProfiles(d.profiles)
        // Дефолтный профиль выбираем автоматически
        const def = d.profiles.find((p) => p.is_default) ?? d.profiles[0]
        if (def) setSelectedSlug(def.slug)
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить список профилей')
      })
      .finally(() => {
        if (!cancelled) setLoadingProfiles(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Загружаем историю экспортов
  const loadHistory = useCallback(() => {
    setLoadingHistory(true)
    apiGet<{ exports: AlbumExport[] }>(
      buildUrl(`/api/layout?action=list_album_exports&album_id=${albumId}`, viewAsTenantId),
    )
      .then((d) => setExports(d.exports))
      .catch(() => {
        // Тихо: история — не критично если не загрузилась
      })
      .finally(() => setLoadingHistory(false))
  }, [albumId, viewAsTenantId])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.slug === selectedSlug) ?? null,
    [profiles, selectedSlug],
  )

  async function handleExport() {
    if (!selectedSlug || exporting) return
    setExporting(true)
    setError(null)
    setLastResult(null)
    try {
      const res = await apiPost<ExportResponse>(
        buildUrl('/api/layout?action=export', viewAsTenantId),
        { album_id: albumId, profile_slug: selectedSlug },
      )
      setLastResult(res)
      // Авто-открываем PDF в новой вкладке
      window.open(res.download_url, '_blank', 'noopener,noreferrer')
      // Обновляем историю
      loadHistory()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  async function handleExportZip() {
    if (exportingZip || !hasLayout) return
    setExportingZip(true)
    setZipError(null)
    setZipResult(null)
    try {
      const res = await apiPost<TypographyResponse>(
        buildUrl('/api/layout?action=export_typography', viewAsTenantId),
        { album_id: albumId },
      )
      setZipResult(res)
      window.open(res.download_url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setZipError((e as Error).message)
    } finally {
      setExportingZip(false)
    }
  }

  // Если layout не собран — кнопка disabled с подсказкой
  const exportDisabled = !hasLayout || !selectedSlug || exporting
  const zipDisabled = !hasLayout || exportingZip || exporting

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">Экспорт PDF</h3>
        {!hasLayout && (
          <span className="text-xs text-muted-foreground">
            Layout не собран — сначала нажмите «Собрать автоматически»
          </span>
        )}
      </div>

      {/* Профиль + кнопка */}
      <div className="flex flex-col md:flex-row md:items-end gap-3 mb-3">
        <div className="flex-1">
          <label className="block text-xs text-muted-foreground mb-1">Профиль</label>
          {loadingProfiles ? (
            <div className="text-sm text-muted-foreground">Загрузка профилей…</div>
          ) : (
            <select
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
              disabled={exporting}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-card text-foreground dark:bg-background focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-muted disabled:cursor-not-allowed"
            >
              {profiles.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {selectedProfile && (
            <div className="mt-1 text-xs text-muted-foreground">
              {profileDescription(selectedProfile)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exportDisabled}
          className="px-5 py-2 bg-black dark:bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-brand-700 disabled:bg-muted disabled:cursor-not-allowed transition whitespace-nowrap"
        >
          {exporting ? 'Экспорт…' : '📄 Экспортировать'}
        </button>
        <button
          type="button"
          onClick={handleExportZip}
          disabled={zipDisabled}
          title="Файлы по книгам (000/00X) под профиль типографии заказа, в zip"
          className="px-5 py-2 bg-card border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted disabled:bg-muted disabled:cursor-not-allowed transition whitespace-nowrap"
        >
          {exportingZip ? 'Сборка…' : '🗂 В типографию (zip)'}
        </button>
      </div>

      {/* Прогресс / результат / ошибка */}
      {exporting && (
        <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-3">
          <div className="flex items-center gap-2">
            <Spinner />
            <span>Идёт сборка PDF… Это может занять 30–60 секунд.</span>
          </div>
        </div>
      )}

      {error && !exporting && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-3">
          ⚠ {error}
        </div>
      )}

      {lastResult && !exporting && !error && (
        <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">✓ PDF готов</div>
              <div className="text-xs text-green-700 mt-0.5">
                {lastResult.filename} · {formatFileSize(lastResult.file_size)} ·{' '}
                {lastResult.page_count} стр.
              </div>
              {lastResult.warnings.length > 0 && (
                <div className="text-xs text-amber-700 mt-1">
                  ⚠ {lastResult.warnings.length} предупреждений
                </div>
              )}
            </div>
            <a
              href={lastResult.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-card border border-green-600 text-green-700 text-xs font-medium rounded hover:bg-green-100"
            >
              Скачать
            </a>
          </div>
        </div>
      )}

      {/* Типографская выгрузка: прогресс / результат / ошибка */}
      {exportingZip && (
        <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-3">
          <div className="flex items-center gap-2">
            <Spinner />
            <span>Собираем файлы по книгам и пакуем в zip…</span>
          </div>
        </div>
      )}

      {zipError && !exportingZip && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-3">
          ⚠ {zipError}
        </div>
      )}

      {zipResult && !exportingZip && !zipError && (
        <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">✓ Архив для типографии готов</div>
              <div className="text-xs text-green-700 mt-0.5">
                {zipResult.file_count} файлов ·{' '}
                {zipResult.accept_mode === 'spread' ? 'разворотами' : 'постранично'}
                {zipResult.has_personal && ' · с личными книгами'}
              </div>
              {zipResult.adapt_status === 'incompatible' && zipResult.adapt_warning && (
                <div className="text-xs text-amber-700 mt-1">⚠ {zipResult.adapt_warning}</div>
              )}
              {zipResult.warnings.length > 0 && (
                <div className="text-xs text-amber-700 mt-1">
                  ⚠ {zipResult.warnings.length} предупреждений
                </div>
              )}
            </div>
            <a
              href={zipResult.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-card border border-green-600 text-green-700 text-xs font-medium rounded hover:bg-green-100 whitespace-nowrap"
            >
              Скачать zip
            </a>
          </div>
        </div>
      )}

      {/* История */}
      <div className="border-t border-border pt-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          История экспортов
        </div>
        {loadingHistory ? (
          <div className="text-sm text-muted-foreground">Загрузка истории…</div>
        ) : exports.length === 0 ? (
          <div className="text-sm text-muted-foreground">Пока нет экспортов</div>
        ) : (
          <ul className="space-y-1.5">
            {exports.map((ex) => (
              <li
                key={ex.id}
                className="flex items-center justify-between gap-3 text-sm py-1"
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate" title={ex.filename}>
                    {ex.filename}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(ex.created_at)}
                    {ex.export_profiles?.name &&
                      ` · ${ex.export_profiles.name}`}
                    {' · '}
                    {formatFileSize(ex.file_size)}
                    {' · '}
                    {ex.page_count} стр.
                    {ex.warnings && ex.warnings.length > 0 && (
                      <span className="text-amber-700">
                        {' '}
                        · ⚠ {ex.warnings.length}
                      </span>
                    )}
                  </div>
                </div>
                <a
                  href={ex.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                >
                  Скачать
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ─── Spinner ─────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-blue-600"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-25"
      />
      <path
        fill="currentColor"
        className="opacity-75"
        d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
      />
    </svg>
  )
}
