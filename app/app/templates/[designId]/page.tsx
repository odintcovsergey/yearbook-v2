/**
 * РЭ.24.5b: страница каталога шаблонов внутри конкретного дизайна.
 * URL: /app/templates/[designId]
 *
 * Партнёр сначала выбирает дизайн на /app/templates (страница верхнего
 * уровня), потом попадает сюда — видит две секции для этого дизайна:
 *
 *     1. «Готовые от OkeyBook» — глобальные шаблоны (is_recommended=true)
 *        привязанные к этому template_set, с кнопкой «Сохранить в мои».
 *     2. «Мои шаблоны» — личная библиотека партнёра (только для
 *        этого template_set), с кнопками «Редактировать» и «Удалить»,
 *        + кнопка «Создать свой шаблон» (создаёт пустой шаблон сразу
 *        привязанный к текущему дизайну).
 *
 * Карточка содержит:
 * - 1 крупное SVG-превью (students = главная характеристика)
 * - 3 малых превью (cover, teachers, soft)
 * - Название + описание + бейджи
 * - Для партнёрских невалидных: красный бейдж «Доработай» + список ошибок
 *
 * При редактировании партнёрского шаблона открывается PresetEditorModal
 * (тот же что в /super/presets) — переиспользуем без копипасты.
 *
 * Сохранение через POST template_clone / template_create_blank /
 * template_delete. После любого изменения — перезагрузка обоих списков.
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import PresetEditorModal, {
  type Preset as EditableP,
} from '@/app/super/presets/_components/PresetEditorModal'

// ─── Типы (синхронны с API templates_list_global/_my) ─────────────────────

interface PreviewBundle {
  students: string | null
  cover: string | null
  teachers: string | null
  soft: string | null
}

interface TemplateBase {
  id: string
  display_name: string
  description: string
  print_type: 'layflat' | 'soft' | null
  sheet_type: 'hard' | 'soft' | null
  student_layout_mode: 'page' | 'spread' | 'grid' | null
  student_grid_size: number | null
  min_pages: number | null
  max_pages: number | null
  previews: PreviewBundle
}

interface GlobalTemplate extends TemplateBase {}

interface MyTemplate extends TemplateBase {
  parent_preset_id: string | null
  valid: boolean
  errors: string[]
}

interface AuthData {
  authenticated: boolean
  user?: { id: string; email: string; full_name: string; role: string }
  tenant?: { id: string; name: string } | null
  isLegacy?: boolean
}

// API-хелпер с auto-refresh при 401.
// При истечении короткоживущего access-token (~15 минут) автоматически
// дёргаем /api/auth action=refresh и повторяем запрос. Без этого после
// 15 минут на странице любые действия (Удалить / Редактировать) тихо
// падали с 401 «Необходима авторизация» — точно та же логика что в
// app/app/page.tsx (см. 6f7f52b → этот fix).
let _refreshing: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  if (_refreshing) return _refreshing
  _refreshing = fetch('/api/auth', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'refresh' }),
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      _refreshing = null
    })
  return _refreshing
}

const api = async (path: string, opts?: RequestInit): Promise<Response> => {
  const res = await fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  })
  if (res.status === 401) {
    const ok = await refreshAccessToken()
    if (ok) {
      return fetch(path, {
        ...opts,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...opts?.headers },
      })
    }
  }
  return res
}

// ─── Главная страница ──────────────────────────────────────────────────────

interface DesignInfo {
  id: string
  name: string
  slug: string
  is_global: boolean
}

export default function TemplatesPage() {
  const router = useRouter()
  const params = useParams()
  const designId = String(params?.designId ?? '')

  const [authChecked, setAuthChecked] = useState(false)
  const [isViewer, setIsViewer] = useState(false)
  const [designInfo, setDesignInfo] = useState<DesignInfo | null>(null)
  const [globalTemplates, setGlobalTemplates] = useState<GlobalTemplate[]>([])
  const [myTemplates, setMyTemplates] = useState<MyTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)
  const [editing, setEditing] = useState<EditableP | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const notify = (text: string, type: 'ok' | 'err' = 'ok') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  // Авторизация
  useEffect(() => {
    api('/api/auth')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: AuthData | null) => {
        if (!d?.authenticated || d.isLegacy) {
          router.push('/login')
          return
        }
        setIsViewer(d.user?.role === 'viewer')
        setAuthChecked(true)
      })
      .catch(() => router.push('/login'))
  }, [router])

  // Загрузка
  const loadAll = useCallback(async () => {
    if (!designId) return
    setLoading(true)
    setError(null)
    try {
      const q = `design_id=${encodeURIComponent(designId)}`
      const [designsResp, globalResp, myResp] = await Promise.all([
        api('/api/tenant?action=designs_list'),
        api(`/api/tenant?action=templates_list_global&${q}`),
        api(`/api/tenant?action=templates_list_my&${q}`),
      ])
      if (!designsResp.ok) {
        const d = await designsResp.json().catch(() => ({}))
        throw new Error(d.error ?? `Дизайны: HTTP ${designsResp.status}`)
      }
      if (!globalResp.ok) {
        const d = await globalResp.json().catch(() => ({}))
        throw new Error(d.error ?? `Каталог: HTTP ${globalResp.status}`)
      }
      if (!myResp.ok) {
        const d = await myResp.json().catch(() => ({}))
        throw new Error(d.error ?? `Мои шаблоны: HTTP ${myResp.status}`)
      }
      const dData = await designsResp.json()
      const found = (dData.designs ?? []).find((d: DesignInfo) => d.id === designId)
      if (!found) {
        setError('Дизайн не найден или недоступен')
        setLoading(false)
        return
      }
      setDesignInfo(found)
      const gData = await globalResp.json()
      const mData = await myResp.json()
      setGlobalTemplates(gData.templates ?? [])
      setMyTemplates(mData.templates ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [designId])

  useEffect(() => {
    if (authChecked) loadAll()
  }, [authChecked, loadAll])

  // Действия
  const handleClone = async (templateId: string) => {
    setBusyId(templateId)
    try {
      const r = await api('/api/tenant', {
        method: 'POST',
        body: JSON.stringify({
          action: 'template_clone',
          template_id: templateId,
        }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      notify('Шаблон сохранён в «Мои»', 'ok')
      await loadAll()
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : 'Ошибка клонирования', 'err')
    } finally {
      setBusyId(null)
    }
  }

  const handleCreateBlank = async () => {
    const name = window.prompt('Название нового шаблона:', 'Мой шаблон')
    if (!name || !name.trim()) return
    try {
      const r = await api('/api/tenant', {
        method: 'POST',
        body: JSON.stringify({
          action: 'template_create_blank',
          display_name: name.trim(),
          template_set_id: designId, // привязка к текущему дизайну (РЭ.24.5b)
        }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      notify('Создан пустой шаблон. Нажмите «Редактировать» чтобы заполнить.', 'ok')
      await loadAll()
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : 'Ошибка создания', 'err')
    }
  }

  const handleDelete = async (templateId: string, displayName: string) => {
    if (!window.confirm(`Удалить шаблон «${displayName}»? Это необратимо.`)) return
    setBusyId(templateId)
    try {
      const r = await api('/api/tenant', {
        method: 'POST',
        body: JSON.stringify({
          action: 'template_delete',
          template_id: templateId,
        }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        // Спецобработка 409 — список альбомов
        if (r.status === 409 && Array.isArray(d.albums)) {
          const list = d.albums
            .slice(0, 5)
            .map((a: { title: string }) => `• ${a.title}`)
            .join('\n')
          notify(
            `${d.error}\n${list}${d.albums.length > 5 ? `\n…и ещё ${d.albums.length - 5}` : ''}`,
            'err',
          )
          return
        }
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      notify('Шаблон удалён', 'ok')
      await loadAll()
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : 'Ошибка удаления', 'err')
    } finally {
      setBusyId(null)
    }
  }

  const handleEdit = async (t: MyTemplate) => {
    setBusyId(t.id)
    try {
      // Загружаем полный preset из rule_presets_list (он возвращает все
      // поля включая section_structure, template_set_id, density и т.д.).
      const r = await api('/api/tenant?action=rule_presets_list')
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${r.status}`)
      }
      const data = await r.json()
      const full = (data.presets ?? []).find((p: { id: string }) => p.id === t.id)
      if (!full) {
        throw new Error('Шаблон не найден')
      }
      // Преобразуем raw row → EditableP (модалка ожидает её форму).
      setEditing({
        id: full.id,
        display_name: full.display_name ?? '',
        tenant_id: full.tenant_id ?? null,
        print_type: full.print_type ?? null,
        density: full.density ?? null,
        sheet_type: full.sheet_type ?? null,
        min_pages: full.min_pages ?? null,
        max_pages: full.max_pages ?? null,
        template_set_id: full.template_set_id ?? null,
        section_structure: full.section_structure ?? null,
        student_pages_per_student: full.student_pages_per_student ?? null,
        student_friend_photos: full.student_friend_photos ?? null,
        student_has_quote: full.student_has_quote ?? null,
        student_layout_mode: full.student_layout_mode ?? null,
        student_grid_size: full.student_grid_size ?? null,
        symmetrize_students_tail: full.symmetrize_students_tail ?? null,
        transition_scenario: full.transition_scenario ?? null,
        version: full.version ?? '1.0',
        is_recommended: full.is_recommended ?? false,
      })
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : 'Ошибка загрузки шаблона', 'err')
    } finally {
      setBusyId(null)
    }
  }

  const handleEditorClose = () => {
    setEditing(null)
  }

  const handleEditorSaved = async () => {
    setEditing(null)
    notify('Сохранено', 'ok')
    await loadAll()
  }

  if (!authChecked) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Заголовок */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs text-gray-400 mb-1">
              <button
                onClick={() => router.push('/app/templates')}
                className="hover:text-gray-700"
              >
                Шаблоны
              </button>
              {' / '}
              <span>{designInfo?.name ?? 'Дизайн'}</span>
            </div>
            <h1 className="text-2xl font-bold">
              Шаблоны: {designInfo?.name ?? '...'}
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Готовые шаблоны от OkeyBook для этого дизайна + ваша личная
              библиотека. При создании альбома выберете один из шаблонов.
            </p>
          </div>
          <button
            onClick={() => router.push('/app/templates')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← К дизайнам
          </button>
        </div>

        {/* Toast */}
        {msg && (
          <div
            className={`mb-4 px-4 py-3 rounded whitespace-pre-line ${
              msg.type === 'ok'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {msg.text}
          </div>
        )}

        {loading && <div className="text-gray-500 mb-4">Загрузка...</div>}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* СЕКЦИЯ 1: Готовые от OkeyBook */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-gray-700 mb-3">
            Готовые от OkeyBook ({globalTemplates.length})
          </h2>
          {globalTemplates.length === 0 && !loading && (
            <div className="text-gray-400 text-sm bg-white border border-gray-200 rounded p-4">
              Пока нет рекомендованных шаблонов от OkeyBook.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {globalTemplates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                kind="global"
                busy={busyId === t.id}
                disabled={isViewer}
                onClone={() => handleClone(t.id)}
              />
            ))}
          </div>
        </section>

        {/* СЕКЦИЯ 2: Мои шаблоны */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-700">
              Мои шаблоны ({myTemplates.length})
            </h2>
            {!isViewer && (
              <button
                onClick={handleCreateBlank}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
              >
                + Создать свой шаблон
              </button>
            )}
          </div>
          {myTemplates.length === 0 && !loading && (
            <div className="text-gray-400 text-sm bg-white border border-gray-200 rounded p-4">
              У вас пока нет своих шаблонов. Нажмите «Сохранить в мои» на
              любом готовом шаблоне или «Создать свой шаблон» сверху.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {myTemplates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                kind="my"
                busy={busyId === t.id}
                disabled={isViewer}
                onEdit={() => handleEdit(t)}
                onDelete={() => handleDelete(t.id, t.display_name)}
              />
            ))}
          </div>
        </section>
      </div>

      {/* Модалка редактирования (использует PresetEditorModal из /super) */}
      {editing && (
        <PresetEditorModal
          preset={editing}
          onClose={handleEditorClose}
          onSaved={handleEditorSaved}
        />
      )}
    </div>
  )
}

// ─── Карточка шаблона ──────────────────────────────────────────────────────

type TemplateCardProps =
  | {
      template: GlobalTemplate
      kind: 'global'
      busy: boolean
      disabled: boolean
      onClone: () => void
    }
  | {
      template: MyTemplate
      kind: 'my'
      busy: boolean
      disabled: boolean
      onEdit: () => void
      onDelete: () => void
    }

function TemplateCard(props: TemplateCardProps) {
  const { template, kind, busy, disabled } = props
  const isMy = kind === 'my'
  const myT = isMy ? (template as MyTemplate) : null
  const isInvalid = myT && !myT.valid

  return (
    <div
      className={`bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow ${
        isInvalid ? 'border-red-300' : 'border-gray-200'
      }`}
    >
      {/* Крупное превью — students */}
      <div
        className="w-full bg-gray-50 border border-gray-200 rounded mb-2 overflow-hidden flex items-center justify-center"
        style={{ aspectRatio: '1 / 1.4', minHeight: '160px' }}
        dangerouslySetInnerHTML={{
          __html:
            template.previews.students ??
            '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:12px;">Нет превью личного раздела</div>',
        }}
      />

      {/* Полоска из 3 малых превью */}
      <div className="grid grid-cols-3 gap-1 mb-3">
        <MiniPreview label="Обложка" svg={template.previews.cover} />
        <MiniPreview label="Учителя" svg={template.previews.teachers} />
        <MiniPreview label="Soft" svg={template.previews.soft} />
      </div>

      {/* Название */}
      <div className="font-semibold text-gray-900 truncate" title={template.display_name}>
        {template.display_name}
      </div>

      {/* Описание */}
      <div className="text-xs text-gray-500 mb-2 min-h-[1.2em]">
        {template.description || '—'}
      </div>

      {/* Бейджи */}
      <div className="flex flex-wrap gap-1 mb-3">
        {template.sheet_type === 'hard' && (
          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
            твёрдая обложка
          </span>
        )}
        {template.sheet_type === 'soft' && (
          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
            мягкая обложка
          </span>
        )}
        {template.student_layout_mode && (
          <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">
            {layoutModeLabel(template.student_layout_mode, template.student_grid_size)}
          </span>
        )}
        {isInvalid && (
          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded">
            Доработай
          </span>
        )}
      </div>

      {/* Ошибки валидации (только для своих) */}
      {isInvalid && myT && (
        <ul className="text-xs text-red-600 mb-3 list-disc pl-4 space-y-0.5">
          {myT.errors.slice(0, 3).map((err, i) => (
            <li key={i}>{err}</li>
          ))}
          {myT.errors.length > 3 && (
            <li className="text-red-400">…и ещё {myT.errors.length - 3}</li>
          )}
        </ul>
      )}

      {/* Кнопки действий */}
      {!disabled && (
        <div className="flex gap-2">
          {kind === 'global' && (
            <button
              onClick={(props as Extract<TemplateCardProps, { kind: 'global' }>).onClone}
              disabled={busy}
              className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded text-sm"
            >
              {busy ? '...' : 'Сохранить в мои'}
            </button>
          )}
          {kind === 'my' && (
            <>
              <button
                onClick={(props as Extract<TemplateCardProps, { kind: 'my' }>).onEdit}
                disabled={busy}
                className="flex-1 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-800 rounded text-sm"
              >
                Редактировать
              </button>
              <button
                onClick={(props as Extract<TemplateCardProps, { kind: 'my' }>).onDelete}
                disabled={busy}
                className="px-3 py-1.5 bg-red-100 hover:bg-red-200 disabled:bg-gray-100 text-red-700 rounded text-sm"
                title="Удалить шаблон"
              >
                {busy ? '...' : '×'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MiniPreview({ label, svg }: { label: string; svg: string | null }) {
  return (
    <div
      className="bg-gray-50 border border-gray-200 rounded overflow-hidden flex items-center justify-center"
      style={{ aspectRatio: '1 / 1.4', minHeight: '50px' }}
      title={label}
      dangerouslySetInnerHTML={{
        __html:
          svg ??
          `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:10px;">${label}: нет</div>`,
      }}
    />
  )
}

function layoutModeLabel(
  mode: 'page' | 'spread' | 'grid',
  gridSize: number | null,
): string {
  if (mode === 'grid' && gridSize) return `сетка ${gridSize}`
  if (mode === 'page') return '1 на стр.'
  if (mode === 'spread') return '1 на разворот'
  return mode
}
