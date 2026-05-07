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

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const buildFormData = (force: boolean): FormData => {
    const fd = new FormData()
    fd.append('file', form.file as File)
    fd.append('name', form.name.trim())
    fd.append('slug', form.slug.trim())
    fd.append('print_type', form.print_type)
    fd.append('tenant_id', 'global')
    if (form.description.trim()) fd.append('description', form.description.trim())
    if (force) fd.append('force', 'true')
    return fd
  }

  // Прямой fetch без api()-helper из page.tsx: для multipart Content-Type
  // (с boundary) должен выставлять браузер автоматически, а api() ставит
  // application/json и сломал бы границы.
  const doSubmit = async (force: boolean) => {
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch('/api/layout?action=import_idml', {
        method: 'POST',
        credentials: 'include',
        body: buildFormData(force),
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
      onSuccess()
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

        {conflictPending ? (
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
              <label className="text-sm font-medium text-gray-700 block mb-1">IDML файл</label>
              <input
                type="file"
                accept=".idml"
                onChange={(e) => set('file', e.target.files?.[0] ?? null)}
                className="input"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Название</label>
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
              <label className="text-sm font-medium text-gray-700 block mb-1">Slug</label>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => set('slug', e.target.value)}
                className="input font-mono"
                placeholder="okeybook-default"
                required
              />
              <div className="text-xs text-gray-500 mt-1">
                Только нижний регистр, цифры и дефисы
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">Тип печати</label>
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
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Описание <span className="text-gray-400">(не обязательно)</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                className="input"
                rows={2}
              />
            </div>

            <div className="text-xs text-gray-500">
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
