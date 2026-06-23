import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Лёгкий health-эндпоинт для авто-деплоя: подтверждает, что приложение поднялось
// И что слой данных (PostgREST/БД) отвечает. Используется health-check.sh после
// переключения релиза — если не 200, деплой откатывается на прошлый релиз.
// Дешёвый HEAD-count по корневой таблице tenants (без выборки строк).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const { error } = await supabaseAdmin
      .from('tenants')
      .select('id', { count: 'exact', head: true })
    if (error) throw error
    return NextResponse.json({ ok: true, db: 'up' })
  } catch {
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 })
  }
}
