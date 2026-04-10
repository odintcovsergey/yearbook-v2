import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET — загрузить черновик
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json(null)

  const { data: child } = await supabaseAdmin
    .from('children').select('id').eq('access_token', token).single()
  if (!child) return NextResponse.json(null)

  const { data } = await supabaseAdmin
    .from('drafts').select('data').eq('child_id', child.id).maybeSingle()

  const draft = data?.data ?? null
  if (!draft) return NextResponse.json(null)

  // Собрать все photo_id из черновика
  const draftPhotoIds = [
    draft.portraitPage,
    draft.portraitCover,
    ...((draft.groupPhotos as string[]) ?? []),
  ].filter(Boolean)

  if (draftPhotoIds.length === 0) return NextResponse.json(draft)

  // Проверить какие из них ещё существуют
  const { data: existingPhotos } = await supabaseAdmin
    .from('photos').select('id').in('id', draftPhotoIds)
  const existingIds = new Set((existingPhotos ?? []).map((p: any) => p.id))

  // Очистить черновик от удалённых фото
  const cleanDraft = {
    ...draft,
    portraitPage: existingIds.has(draft.portraitPage) ? draft.portraitPage : null,
    portraitCover: existingIds.has(draft.portraitCover) ? draft.portraitCover : null,
    groupPhotos: ((draft.groupPhotos as string[]) ?? []).filter((id: string) => existingIds.has(id)),
  }

  return NextResponse.json(cleanDraft)
}

// POST — сохранить черновик
export async function POST(req: NextRequest) {
  const { token, data } = await req.json()
  if (!token) return NextResponse.json({ error: 'Нет токена' }, { status: 400 })

  const { data: child } = await supabaseAdmin
    .from('children').select('id').eq('access_token', token).single()
  if (!child) return NextResponse.json({ error: 'Не найден' }, { status: 404 })

  await supabaseAdmin.from('drafts').upsert(
    { child_id: child.id, data, updated_at: new Date().toISOString() },
    { onConflict: 'child_id' }
  )

  // Отметить что родитель начал заполнение
  await supabaseAdmin.from('children')
    .update({ started_at: new Date().toISOString() })
    .eq('id', child.id)
    .is('started_at', null)

  return NextResponse.json({ ok: true })
}
