'use client'

import { useState, FormEvent } from 'react'

type FormState = {
  file: File | null
  name: string
  slug: string
  print_type: 'layflat' | 'soft'
  description: string
}

const SLUG_REGEX = /^[a-z0-9-]+$/

// Фаза 2: отчёт сверки с каноном master_page_types (приходит в ответе import_idml).
type CanonReason = 'matched' | 'unmapped' | 'no-canon-type'
type CanonReport = {
  recognized: number
  total: number
  unmatched: Array<{ name: string; reason: CanonReason }>
}

// Человекочитаемая причина «не легло в канон».
const reasonLabel = (r: CanonReason): string =>
  r === 'unmapped'
    ? 'не размечен (нет в family-mapping)'
    : r === 'no-canon-type'
      ? 'новый тип, нет в каноне'
      : '—'

const emptyForm = (): FormState => ({
  file: null,
  name: '',
  slug: '',
  print_type: 'layflat',
  description: '',
})

export default function UploadModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictPending, setConflictPending] = useState(false)
  const [backdropStart, setBackdropStart] = useState(false)
  // Фаза 2: после успешной загрузки показываем отчёт сверки с каноном (вместо
  // мгновенного закрытия). null = ещё не загружено.
  const [result, setResult] = useState<CanonReport | null>(null)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(prev => ({ ...prev, [k]: v }))

  // IDML заливается НЕ в тело функции (лимит Vercel ~4.5 МБ → HTTP 413), а
  // напрямую в хранилище по presigned URL. Затем импорт зовётся с storage_key,
  // сервер скачивает файл из хранилища и парсит.
  const IDML_CONTENT_TYPE = 'application/octet-stream'

  const doSubmit = async (force: boolean) => {
    const file = form.file as File
    setSubmitting(true)
    setError(null)
    try {
      // 1) presigned URL для прямой загрузки IDML в хранилище.
      const presignRes = await fetch('/api/upload-url', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_type: 'idml',
          filename: file.name,
          content_type: IDML_CONTENT_TYPE,
        }),
      })
      const presign = await presignRes.json().catch(() => ({}))
      if (!presignRes.ok || !presign.upload_url) {
        setError(presign.error || `Не удалось получить ссылку загрузки (HTTP ${presignRes.status})`)
        setSubmitting(false)
        return
      }

      // 2) PUT файла в хранилище. Content-Type строго тот же, что подписан.
      const putRes = await fetch(presign.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': IDML_CONTENT_TYPE },
        body: file,
      })
      if (!putRes.ok) {
        setError(`Не удалось загрузить файл в хранилище (HTTP ${putRes.status})`)
        setSubmitting(false)
        return
      }

      // 3) Импорт по storage_key (маленькое JSON-тело, под лимит проходит).
      const r = await fetch('/api/layout?action=import_idml', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storage_key: presign.key,
          name: form.name.trim(),
          slug: form.slug.trim(),
          print_type: form.print_type,
          tenant_id: 'global',
          description: form.description.trim() || undefined,
          force,
        }),
      })
      const data = await r.json().catch(() => ({}))

      if (r.status === 409 && data.error === 'slug_exists') {
        setConflictPending(true)
        setSubmitting(false)
        return
      }
      if (!r.ok) {
        setError(data.message || data.error || `HTTP ${r.status}`)
        setSubmitting(false)
        return
      }
      setSubmitting(false)
      // Фаза 2: показываем отчёт сверки с каноном. Закрытие — по кнопке (onSuccess).
      setResult(
        (data.canon_report as CanonReport | undefined) ?? {
          recognized: data.spread_count ?? 0,
          total: data.spread_count ?? 0,
          unmatched: [],
        },
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Сеть недоступна')
      setSubmitting(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!form.file) { setError('Выберите IDML-файл'); return }
    if (!form.name.trim()) { setError('Заполните название'); return }
    if (!SLUG_REGEX.test(form.slug.trim())) {
      setError('Slug может содержать только нижний регистр, цифры и дефисы')
      return
    }
    doSubmit(false)
  }

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) setBackdropStart(true) }}
      onMouseUp={(e) => {
        if (backdropStart && e.target === e.currentTarget) onClose()
        setBackdropStart(false)
      }}
      className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center py-8 px-4 overflow-y-auto"
    >
      <div className="card p-6 w-full max-w-lg">
        <h2
          className="text-xl font-semibold mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Загрузить IDML
        </h2>

        {result ? (
          <div className="space-y-4">
            {result.unmatched.length === 0 ? (
              <div className="card p-4 bg-emerald-50 border-emerald-200">
                <div className="font-medium text-emerald-900">
                  Распознано {result.recognized} из {result.total} ✓
                </div>
                <div className="text-sm text-emerald-700 mt-1">
                  Все мастера легли в канон типов разворотов.
                </div>
              </div>
            ) : (
              <div className="card p-4 bg-amber-50 border-amber-200">
                <div className="font-medium text-amber-900 mb-1">
                  Распознано {result.recognized} из {result.total}
                </div>
                <div className="text-sm text-amber-700 mb-2">
                  Не легло в канон ({result.unmatched.length}):
                </div>
                <ul className="text-sm text-amber-800 space-y-1 max-h-60 overflow-y-auto">
                  {result.unmatched.map((u) => (
                    <li key={u.name} className="flex flex-col">
                      <span className="font-mono">{u.name}</span>
                      <span className="text-xs text-amber-600">{reasonLabel(u.reason)}</span>
                    </li>
                  ))}
                </ul>
                <div className="text-xs text-amber-600 mt-2">
                  Загрузка прошла — это мягкая сверка, дизайн уже создан. Канон используется только для справки.
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={onSuccess} className="btn-primary">
                Закрыть
              </button>
            </div>
          </div>
        ) : conflictPending ? (
          <div className="space-y-4">
            <div className="card p-4 bg-amber-50 border-amber-200">
              <div className="font-medium text-amber-900 mb-1">
                Шаблон с этим slug уже существует
              </div>
              <div className="text-sm text-amber-700">
                Перезаписать существующий template_set «{form.slug}»? Это удалит все его spread_templates и заменит содержимое.
              </div>
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConflictPending(false)} className="btn-secondary" disabled={submitting}>
                Назад
              </button>
              <button onClick={() => doSubmit(true)} className="btn-primary" disabled={submitting}>
                {submitting ? 'Перезаписываю…' : 'Перезаписать'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">IDML файл</label>
              <input
                type="file"
                accept=".idml"
                onChange={(e) => set('file', e.target.files?.[0] ?? null)}
                className="input"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground block mb-1">Название</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                className="input"
                placeholder="Плотные Мастер Белый"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground block mb-1">Slug</label>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => set('slug', e.target.value)}
                className="input font-mono"
                placeholder="okeybook-default"
                required
              />
              <div className="text-xs text-muted-foreground mt-1">
                Только нижний регистр, цифры и дефисы
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground block mb-2">Тип печати</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="print_type" checked={form.print_type === 'layflat'}
                    onChange={() => set('print_type', 'layflat')} />
                  <span className="text-sm">Layflat</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="print_type" checked={form.print_type === 'soft'}
                    onChange={() => set('print_type', 'soft')} />
                  <span className="text-sm">Soft</span>
                </label>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground block mb-1">
                Описание <span className="text-muted-foreground">(не обязательно)</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                className="input"
                rows={2}
              />
            </div>

            <div className="text-xs text-muted-foreground">
              Шаблон будет доступен всем tenant'ам системы (global).
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={onClose} className="btn-secondary" disabled={submitting}>
                Отмена
              </button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Загружаю…' : 'Загрузить'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
