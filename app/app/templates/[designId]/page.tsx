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
import { api } from '@/lib/api-client'
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

// api() с auto-refresh JWT теперь импортируется из @/lib/api-client.
// Module ранее жил здесь локально (5cc4a7d добавил его сюда; общий
// клиент — следующая итерация чтобы не дублировать код).

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
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Заголовок */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              <button
                onClick={() => router.push('/app')}
                className="hover:text-foreground"
              >
                Главная
              </button>
              {' / '}
              <button
                onClick={() => router.push('/app/templates')}
                className="hover:text-foreground"
              >
                Шаблоны
              </button>
              {' / '}
              <span>{designInfo?.name ?? 'Дизайн'}</span>
            </div>
            <h1 className="text-2xl font-bold">
              Шаблоны: {designInfo?.name ?? '...'}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Готовые шаблоны от OkeyBook для этого дизайна + ваша личная
              библиотека. При создании альбома выберете один из шаблонов.
            </p>
          </div>
          <button
            onClick={() => router.push('/app/templates')}
            className="text-sm text-muted-foreground hover:text-foreground"
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

        {loading && <div className="text-muted-foreground mb-4">Загрузка...</div>}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* СЕКЦИЯ 1: Готовые от OkeyBook */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-foreground mb-3">
            Готовые от OkeyBook ({globalTemplates.length})
          </h2>
          {globalTemplates.length === 0 && !loading && (
            <div className="text-muted-foreground text-sm bg-card border border-border rounded p-4">
              Пока нет рекомендованных шаблонов от OkeyBook.
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
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
            <h2 className="text-lg font-semibold text-foreground">
              Мои шаблоны ({myTemplates.length})
            </h2>
            {!isViewer && (
              <button
                onClick={handleCreateBlank}
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm"
              >
                + Создать свой шаблон
              </button>
            )}
          </div>
          {myTemplates.length === 0 && !loading && (
            <div className="text-muted-foreground text-sm bg-card border border-border rounded p-4">
              У вас пока нет своих шаблонов. Нажмите «Сохранить в мои» на
              любом готовом шаблоне или «Создать свой шаблон» сверху.
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
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
      className={`bg-card border rounded-xl p-3 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-150 ${
        isInvalid ? 'border-red-300' : 'border-border'
      }`}
    >
      {/* Крупное превью — students. РЭ.47: aspect ratio 1:1.4 (страница
          вертикальная), минимальная высота уменьшена с 160 до 110px для
          компактного грида. */}
      <div
        className="w-full bg-muted border border-border rounded-lg mb-2 overflow-hidden flex items-center justify-center"
        style={{ aspectRatio: '1 / 1.4' }}
        dangerouslySetInnerHTML={{
          __html:
            template.previews.students ??
            '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:10px;">Нет превью</div>',
        }}
      />

      {/* Название */}
      <div className="font-semibold text-foreground text-sm truncate" title={template.display_name}>
        {template.display_name}
      </div>

      {/* Описание */}
      <div className="text-xs text-muted-foreground mb-2 truncate" title={template.description || ''}>
        {template.description || '—'}
      </div>

      {/* Бейджи */}
      <div className="flex flex-wrap gap-1 mb-2">
        {template.sheet_type === 'hard' && (
          <span className="px-2 py-0.5 bg-muted text-muted-foreground text-[10px] font-medium rounded-full">
            твёрдая
          </span>
        )}
        {template.sheet_type === 'soft' && (
          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded-full">
            мягкая
          </span>
        )}
        {template.student_layout_mode && (
          <span className="px-2 py-0.5 bg-muted text-muted-foreground text-[10px] font-medium rounded-full">
            {layoutModeLabel(template.student_layout_mode, template.student_grid_size)}
          </span>
        )}
        {isInvalid && (
          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-medium rounded-full">
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
        <div className="flex gap-1.5">
          {kind === 'global' && (
            <button
              onClick={(props as Extract<TemplateCardProps, { kind: 'global' }>).onClone}
              disabled={busy}
              className="flex-1 px-2 py-1 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-300 text-white rounded-lg text-xs"
            >
              {busy ? '...' : 'Сохранить в мои'}
            </button>
          )}
          {kind === 'my' && (
            <>
              <button
                onClick={(props as Extract<TemplateCardProps, { kind: 'my' }>).onEdit}
                disabled={busy}
                className="flex-1 px-2 py-1 bg-muted hover:bg-muted disabled:bg-muted text-foreground rounded-lg text-xs"
              >
                Редактировать
              </button>
              <button
                onClick={(props as Extract<TemplateCardProps, { kind: 'my' }>).onDelete}
                disabled={busy}
                className="px-2 py-1 bg-red-100 hover:bg-red-200 disabled:bg-muted text-red-700 rounded-lg text-xs"
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

function layoutModeLabel(
  mode: 'page' | 'spread' | 'grid',
  gridSize: number | null,
): string {
  if (mode === 'grid' && gridSize) return `сетка ${gridSize}`
  if (mode === 'page') return '1 на стр.'
  if (mode === 'spread') return '1 на разворот'
  return mode
}
