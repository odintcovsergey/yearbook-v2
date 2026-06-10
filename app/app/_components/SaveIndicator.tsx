'use client'

type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

export default function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'saved') {
    return <span className="text-xs text-green-600">✓ Сохранено</span>
  }
  if (status === 'pending') {
    return <span className="text-xs text-amber-600">● Не сохранено</span>
  }
  if (status === 'saving') {
    return <span className="text-xs text-muted-foreground">Сохраняется…</span>
  }
  if (status === 'error') {
    return <span className="text-xs text-red-600">⚠ Ошибка сохранения</span>
  }
  return null
}
