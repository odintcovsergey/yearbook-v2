import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getPhotoUrl, getThumbUrl } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Токен не указан' }, { status: 400 })

  const { data: child, error } = await supabaseAdmin
    .from('children')
    .select('id, full_name, class, submitted_at, album_id')
    .eq('access_token', token)
    .single()

  if (error || !child)
    return NextResponse.json({ error: 'Ссылка недействительна. Обратитесь к организатору.' }, { status: 404 })

  const { data: album } = await supabaseAdmin
    .from('albums')
    .select('id, title, cover_mode, cover_price, deadline, group_enabled, group_min, group_max, group_exclusive, text_enabled, text_max_chars, text_type')
    .eq('id', child.album_id)
    .single()

  if (album?.deadline && new Date(album.deadline) < new Date())
    return NextResponse.json({ error: 'Срок выбора фотографий истёк.' }, { status: 410 })

  const { data: allPortraits } = await supabaseAdmin
    .from('photos')
    .select('id, filename, storage_path, thumb_path')
    .eq('album_id', child.album_id)
    .eq('type', 'portrait')
    .order('filename')

  const { data: portraitLocks } = await supabaseAdmin
    .from('photo_locks')
    .select('photo_id, child_id')
    .in('photo_id', (allPortraits ?? []).map((p: any) => p.id))

  const { data: confirmedPortraits } = await supabaseAdmin
    .from('selections')
    .select('photo_id, child_id')
    .eq('selection_type', 'portrait_page')
    .in('photo_id', (allPortraits ?? []).map((p: any) => p.id))

  const portraitLockedByOther = new Set([
    ...(portraitLocks ?? []).filter((l: any) => l.child_id !== child.id).map((l: any) => l.photo_id),
    ...(confirmedPortraits ?? []).filter((s: any) => s.child_id !== child.id).map((s: any) => s.photo_id),
  ])

  const portraits = (allPortraits ?? []).map((p: any) => ({
    ...p,
    url: getPhotoUrl(p.storage_path),
    thumb: getThumbUrl(p.storage_path, (p as any).thumb_path ?? null),
    locked: portraitLockedByOther.has(p.id),
  }))

  const { data: groupPhotos } = await supabaseAdmin
    .from('photos')
    .select('id, filename, storage_path, thumb_path')
    .eq('album_id', child.album_id)
    .eq('type', 'group')
    .order('filename')

  const { data: groupLocks } = await supabaseAdmin
    .from('photo_locks')
    .select('photo_id, child_id')
    .in('photo_id', (groupPhotos ?? []).map((p: any) => p.id))

  const { data: confirmedGroups } = await supabaseAdmin
    .from('selections')
    .select('photo_id, child_id')
    .eq('selection_type', 'group')
    .in('photo_id', (groupPhotos ?? []).map((p: any) => p.id))

  const groupLockedByOther = new Set([
    ...(groupLocks ?? []).filter((l: any) => l.child_id !== child.id).map((l: any) => l.photo_id),
    ...(confirmedGroups ?? []).filter((s: any) => s.child_id !== child.id).map((s: any) => s.photo_id),
  ])

  const groups = (groupPhotos ?? []).map((p: any) => ({
    ...p,
    url: getPhotoUrl(p.storage_path),
    thumb: getThumbUrl(p.storage_path, (p as any).thumb_path ?? null),
    locked: album?.group_exclusive !== false && groupLockedByOther.has(p.id),
  }))

  const [existingSelections, existingContact, existingText, existingCover] = await Promise.all([
    supabaseAdmin.from('selections').select('photo_id, selection_type').eq('child_id', child.id),
    supabaseAdmin.from('parent_contacts').select('parent_name, phone, referral').eq('child_id', child.id).maybeSingle(),
    supabaseAdmin.from('student_texts').select('text').eq('child_id', child.id).maybeSingle(),
    supabaseAdmin.from('cover_selections').select('cover_option, photo_id, surcharge').eq('child_id', child.id).maybeSingle(),
  ])

  // Загружаем цитаты если это альбом 9-11 класса
  let quotes: any[] = []
  let takenQuoteIds: string[] = []
  if ((album as any)?.text_type === 'grade11') {
    const [quotesRes, takenRes] = await Promise.all([
      supabaseAdmin.from('quotes').select('id, text, category').order('category').order('created_at'),
      supabaseAdmin.from('quote_selections').select('quote_id, child_id').eq('album_id', child.album_id),
    ])
    quotes = quotesRes.data ?? []
    // Цитаты занятые другими детьми
    takenQuoteIds = (takenRes.data ?? [])
      .filter((q: any) => q.child_id !== child.id)
      .map((q: any) => q.quote_id)
  }

  // Текущая выбранная цитата этого ребёнка
  const myQuote = await supabaseAdmin.from('quote_selections')
    .select('quote_id').eq('child_id', child.id).maybeSingle()

  return NextResponse.json({
    child, album, portraits, groups, referral: existingContact.data?.referral ?? null,
    quotes, takenQuoteIds,
    selectedQuoteId: myQuote.data?.quote_id ?? null,
    existing: {
      selections: existingSelections.data ?? [],
      contact: existingContact.data,
      text: existingText.data?.text ?? '',
      cover: existingCover.data,
    },
  })
}
