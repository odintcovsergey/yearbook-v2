'use client'

import { useState, FormEvent } from 'react'

export default function CoverUploadModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [isPublished, setIsPublished] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictPending, setConflictPending] = useState(false)
  const [result, setResult] = useState<{ cover_count: number; names: string[]; warnings: string[] } | null>(null)

  const buildFormData = (force: boolean): FormData => {
    const fd = new FormData()
    fd.append('file', file as File)
    fd.append('tenant_id', 'global')
    if (isPublished) fd.append('is_published', 'true')
    if (force) fd.append('force', 'true')
    return fd
  }

  const doSubmit = async (force: boolean) => {
    setSubmitting(true)
    setError(null)
    try {
      const r = await fetch('/api/covers?action=import', {
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
      setResult({ cover_count: data.cover_count ?? 0, names: data.names ?? [], warnings: data.warnings ?? [] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Сеть недоступна')
      setSubmitting(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!file) { setError('Выберите IDML-файл'); return }
    doSubmit(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-start justify-center py-8 px-4 overflow-y-auto" onClick={onClose}>
      <div className="card p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-semibold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
          Загрузить обложку (IDML)
        </h2>

        {result ? (
          <div className="space-y-4">
            <div className="card p-4 bg-green-50 border-green-200 text-sm text-green-900">
              Загружено обложек: <b>{result.cover_count}</b>
              {result.names.length > 0 && (
                <div className="mt-1 font-mono text-xs text-green-700">{result.names.join(', ')}</div>
              )}
            </div>
            {result.warnings.length > 0 && (
              <div className="card p-4 bg-amber-50 border-amber-200 text-xs text-amber-800">
                <div className="font-medium mb-1">Предупреждения:</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={() => { onSuccess() }} className="btn-primary">Готово</button>
            </div>
          </div>
        ) : conflictPending ? (
          <div className="space-y-4">
            <div className="card p-4 bg-amber-50 border-amber-200">
              <div className="font-medium text-amber-900 mb-1">Обложка с таким именем уже есть</div>
              <div className="text-sm text-amber-700">Перезаписать существующую обложку этим макетом?</div>
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConflictPending(false)} className="btn-secondary" disabled={submitting}>Назад</button>
              <button onClick={() => doSubmit(true)} className="btn-primary" disabled={submitting}>
                {submitting ? 'Перезаписываю…' : 'Перезаписать'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">IDML файл обложки</label>
              <input type="file" accept=".idml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input" required />
              <div className="text-xs text-muted-foreground mt-1">
                Обложка = один разворот из 3 страниц (задняя | корешок | передняя), имя мастера на C-.
                См. docs/designer-cover-instructions.md
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
              Опубликовать сразу (видна в выборе)
            </label>

            <div className="text-xs text-muted-foreground">Обложка будет глобальной (для всех партнёров).</div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={onClose} className="btn-secondary" disabled={submitting}>Отмена</button>
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
