'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Ruler } from 'lucide-react'
import TemplateSetCard, { type CardAction } from './_components/TemplateSetCard'
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

// Действия с дизайном идут POST'ом в /api/tenant (superadmin видит все наборы).
const tenantAction = (body: Record<string, unknown>) =>
  api('/api/tenant', { method: 'POST', body: JSON.stringify(body) })

export default function TemplatesPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [templates, setTemplates] = useState<TemplateSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  // id набора, по которому идёт операция (блокирует его меню).
  const [busyId, setBusyId] = useState<string | null>(null)
  // Модалки.
  const [renameFor, setRenameFor] = useState<TemplateSet | null>(null)
  const [deleteFor, setDeleteFor] = useState<TemplateSet | null>(null)
  const [spineMarginFor, setSpineMarginFor] = useState<TemplateSet | null>(null)

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
      // Сортировка: опубликованные сверху, внутри — по имени.
      enriched.sort((a, b) => {
        if (a.is_published !== b.is_published) return a.is_published ? -1 : 1
        return a.name.localeCompare(b.name, 'ru')
      })
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

  // Выполнить серверное действие + перезагрузить список.
  const runAction = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setBusyId(id)
      try {
        const r = await tenantAction(body)
        const d = await r.json().catch(() => ({} as Record<string, unknown>))
        if (!r.ok) {
          return {
            ok: false as const,
            error: (d.error as string) ?? `HTTP ${r.status}`,
            data: d as Record<string, unknown>,
          }
        }
        await loadTemplates()
        return { ok: true as const }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Ошибка операции'
        return { ok: false as const, error: msg }
      } finally {
        setBusyId(null)
      }
    },
    [loadTemplates],
  )

  // Роутинг действий из меню карточки.
  const handleCardAction = (t: TemplateSet, action: CardAction) => {
    switch (action) {
      case 'rename':
        setRenameFor(t)
        break
      case 'spine_margin':
        setSpineMarginFor(t)
        break
      case 'delete':
        setDeleteFor(t)
        break
      case 'duplicate':
        runAction(t.id, {
          action: 'template_set_duplicate',
          template_set_id: t.id,
        }).then(res => {
          if (!res.ok) alert('Не удалось дублировать: ' + res.error)
        })
        break
      case 'toggle_global':
        runAction(t.id, {
          action: 'template_set_update',
          template_set_id: t.id,
          make_global: !t.is_global,
        }).then(res => {
          if (!res.ok) alert('Не удалось изменить глобальность: ' + res.error)
        })
        break
      case 'toggle_published':
        runAction(t.id, {
          action: 'template_set_update',
          template_set_id: t.id,
          is_published: !t.is_published,
        }).then(res => {
          if (!res.ok) alert('Не удалось изменить статус публикации: ' + res.error)
        })
        break
    }
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Проверка авторизации…
      </div>
    )
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2"><Ruler size={22} /> Шаблоны вёрстки</h1>
            <p className="text-sm text-muted-foreground">
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
          <div className="text-center py-12 text-muted-foreground">Загрузка…</div>
        )}

        {error && !loading && (
          <div className="card p-6 text-center">
            <div className="text-red-600 mb-3">{error}</div>
            <button onClick={loadTemplates} className="btn-secondary">Повторить</button>
          </div>
        )}

        {!loading && !error && templates.length === 0 && (
          <div className="card p-12 text-center text-muted-foreground">
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
                busy={busyId === t.id}
                onOpen={() => router.push(`/super/templates/${t.id}`)}
                onAction={(action) => handleCardAction(t, action)}
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

        {renameFor && (
          <RenameModal
            template={renameFor}
            onClose={() => setRenameFor(null)}
            onSubmit={async (name) => {
              const res = await runAction(renameFor.id, {
                action: 'template_set_update',
                template_set_id: renameFor.id,
                name,
              })
              if (res.ok) setRenameFor(null)
              return res
            }}
          />
        )}

        {spineMarginFor && (
          <SpineMarginModal
            template={spineMarginFor}
            onClose={() => setSpineMarginFor(null)}
            onSubmit={async (value) => {
              const res = await runAction(spineMarginFor.id, {
                action: 'template_set_update',
                template_set_id: spineMarginFor.id,
                spine_margin_mm: value,
              })
              if (res.ok) setSpineMarginFor(null)
              return res
            }}
          />
        )}

        {deleteFor && (
          <DeleteModal
            template={deleteFor}
            onClose={() => setDeleteFor(null)}
            onConfirm={async (force) => {
              const res = await runAction(deleteFor.id, {
                action: 'template_set_delete',
                template_set_id: deleteFor.id,
                force,
              })
              if (res.ok) setDeleteFor(null)
              return res
            }}
          />
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Модалка переименования
// ──────────────────────────────────────────────────────────────────────────
function RenameModal({
  template,
  onClose,
  onSubmit,
}: {
  template: TemplateSet
  onClose: () => void
  onSubmit: (name: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [name, setName] = useState(template.name)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setErr('Имя не может быть пустым'); return }
    setSaving(true)
    setErr(null)
    const res = await onSubmit(trimmed)
    setSaving(false)
    if (!res.ok) setErr(res.error ?? 'Ошибка')
  }

  return (
    <ModalShell onClose={onClose} title="Переименовать дизайн">
      <p className="text-sm text-muted-foreground mb-3">
        Меняется только отображаемое имя. Технический идентификатор (slug)
        остаётся прежним.
      </p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        className="w-full border rounded px-3 py-2 text-sm mb-1"
        placeholder="Название дизайна"
      />
      <div className="text-xs text-muted-foreground font-mono mb-3">{template.slug}</div>
      {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Отмена
        </button>
        <button onClick={submit} disabled={saving} className="btn-primary">
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </ModalShell>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Модалка удаления (двойное подтверждение — ввод имени)
// ──────────────────────────────────────────────────────────────────────────
function DeleteModal({
  template,
  onClose,
  onConfirm,
}: {
  template: TemplateSet
  onClose: () => void
  onConfirm: (force: boolean) => Promise<{
    ok: boolean
    error?: string
    data?: Record<string, unknown>
  }>
}) {
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Когда сервер ответил «используется» (409 + can_force) — показываем
  // предупреждение с числами и кнопку форсированного удаления.
  const [inUse, setInUse] = useState<{ albums: number; presets: number } | null>(
    null,
  )
  const matches = confirm.trim() === template.name.trim()

  const run = async (force: boolean) => {
    if (!matches) return
    setDeleting(true)
    setErr(null)
    const res = await onConfirm(force)
    setDeleting(false)
    if (res.ok) return
    // Заблокировано использованием и можно форсировать — показываем шаг force.
    if (!force && res.data?.can_force) {
      setInUse({
        albums: Number(res.data.albums_count ?? 0),
        presets: Number(res.data.presets_count ?? 0),
      })
      return
    }
    setErr(res.error ?? 'Ошибка')
  }

  const usageText = inUse
    ? [
        inUse.albums > 0 ? `${inUse.albums} альбом(ах)` : null,
        inUse.presets > 0 ? `${inUse.presets} пресет(ах)` : null,
      ]
        .filter(Boolean)
        .join(' и ')
    : ''

  return (
    <ModalShell onClose={onClose} title="Удалить дизайн">
      <p className="text-sm text-foreground mb-3">
        Дизайн <b>«{template.name}»</b> будет удалён вместе со всеми его
        мастерами и фонами. Действие необратимо.
      </p>
      <p className="text-sm text-muted-foreground mb-2">
        Если дизайн где-то используется, сначала будет показано предупреждение —
        удалить можно будет с отвязкой по подтверждению.
      </p>
      <p className="text-sm text-foreground mb-1">
        Для подтверждения введите название дизайна:
      </p>
      <input
        autoFocus
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="w-full border rounded px-3 py-2 text-sm mb-3"
        placeholder={template.name}
      />

      {inUse && (
        <div className="text-sm rounded border border-red-500/40 bg-red-500/10 p-3 mb-3">
          <div className="text-red-400 font-medium mb-1">
            Дизайн используется в {usageText}.
          </div>
          <div className="text-muted-foreground">
            Если удалить с отвязкой: эти альбомы и пресеты переключатся на
            дизайн по умолчанию. Их сохранённая вёрстка ссылается на удаляемые
            мастера — её придётся пересобрать. Действие необратимо.
          </div>
        </div>
      )}

      {err && <div className="text-sm text-red-600 mb-3">{err}</div>}

      <div className="flex justify-end gap-2">
        <button onClick={onClose} disabled={deleting} className="btn-secondary">
          Отмена
        </button>
        {inUse ? (
          <button
            onClick={() => run(true)}
            disabled={!matches || deleting}
            className="px-4 py-2 text-sm rounded bg-red-600 hover:bg-red-700 disabled:bg-muted text-white"
          >
            {deleting ? 'Удаление…' : 'Удалить с отвязкой'}
          </button>
        ) : (
          <button
            onClick={() => run(false)}
            disabled={!matches || deleting}
            className="px-4 py-2 text-sm rounded bg-red-600 hover:bg-red-700 disabled:bg-muted text-white"
          >
            {deleting ? 'Удаление…' : 'Удалить навсегда'}
          </button>
        )}
      </div>
    </ModalShell>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Модалка «Отступ от корешка» (модель полей)
// ──────────────────────────────────────────────────────────────────────────
function SpineMarginModal({
  template,
  onClose,
  onSubmit,
}: {
  template: TemplateSet
  onClose: () => void
  onSubmit: (value: number | null) => Promise<{ ok: boolean; error?: string }>
}) {
  // Пустая строка = выключено (legacy авто-зеркало). Число = поле у корешка.
  const [value, setValue] = useState<string>(
    template.spine_margin_mm != null ? String(template.spine_margin_mm) : '',
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = value.trim()
    let payload: number | null
    if (trimmed === '') {
      payload = null
    } else {
      const n = Number(trimmed.replace(',', '.'))
      if (!Number.isFinite(n) || n < 0 || n > 60) {
        setErr('Введите число от 0 до 60 мм или оставьте пустым')
        return
      }
      payload = n
    }
    setSaving(true)
    setErr(null)
    const res = await onSubmit(payload)
    setSaving(false)
    if (!res.ok) setErr(res.error ?? 'Ошибка')
  }

  return (
    <ModalShell onClose={onClose} title="Отступ от корешка">
      <p className="text-sm text-muted-foreground mb-3">
        Система ставит блок контента так, чтобы у корешка было это поле (мм).
        Внешний край получает остаток. Работает на обеих страницах разворота и
        заменяет авто-зеркало. Применяется ко всему дизайну.
      </p>
      <p className="text-sm text-muted-foreground mb-3">
        Оставьте пустым, чтобы вернуть прежнее поведение (авто-зеркало).
      </p>
      <label className="text-sm text-foreground block mb-1">Поле у корешка, мм</label>
      <input
        autoFocus
        type="number"
        min={0}
        max={60}
        step={0.5}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        className="input"
        placeholder="напр. 10 (пусто = выключено)"
      />
      {err && <div className="text-sm text-red-600 mt-3">{err}</div>}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Отмена
        </button>
        <button onClick={submit} disabled={saving} className="btn-primary">
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </ModalShell>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Общая обёртка модалки
// ──────────────────────────────────────────────────────────────────────────
function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
        {children}
      </div>
    </div>
  )
}
