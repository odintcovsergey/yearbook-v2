import { NextResponse } from 'next/server'

/**
 * H2 (аудит безопасности): не отдаём сырые сообщения Postgres/PostgREST клиенту —
 * они раскрывают названия таблиц/колонок/ограничений (карта схемы). Полную ошибку
 * пишем в серверный лог (Vercel), клиенту — обобщённое сообщение + статус 500.
 *
 * context — короткая метка места вызова (обычно имя роута), чтобы найти в логах.
 */
export function serverError(err: unknown, context: string): NextResponse {
  const detail = err instanceof Error ? err.message : err
  console.error(`[serverError:${context}]`, detail)
  return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
}
