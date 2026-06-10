import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getPhotoUrl, getThumbUrl } from '@/lib/supabase'
import { buildCoverGallery } from '@/lib/cover/parent-gallery'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Токен не указан' }, { status: 400 })

  const { data: child, error } = await supabaseAdmin
    .from('children')
    .select('id, full_name, class, submitted_at, album_id, is_purchased, text_assist_count')
    .eq('access_token', token)
    .single()

  if (error || !child)
    return NextResponse.json({ error: 'Ссылка недействительна. Обратитесь к организатору.' }, { status: 404 })

  const { data: album } = await supabaseAdmin
    .from('albums')
    .select('id, title, tenant_id, cover_mode, cover_price, cover_portrait_charge, cover_layout_mode, cover_default_type, cover_available_ids, deadline, group_enabled, group_min, group_max, group_exclusive, text_enabled, text_max_chars, text_type, text_assist_enabled, personal_spread_enabled, personal_spread_price, personal_spread_min, personal_spread_max, referral_program_id')
    .eq('id', child.album_id)
    .single()

  if (album?.deadline && new Date(album.deadline) < new Date())
    return NextResponse.json({ error: 'Срок выбора фотографий истёк.' }, { status: 410 })

  // Реферальная программа альбома (сторона реферера: что родитель видит
  // на «Спасибо»). NULL программа → отдаём null, страница покажет дефолт.
  let referralProgram: { referrer_reward_text: string | null; referrer_image_url: string | null } | null = null
  if ((album as any)?.referral_program_id) {
    const { data: prog } = await supabaseAdmin
      .from('referral_programs')
      .select('referrer_reward_text, referrer_image_url, is_active')
      .eq('id', (album as any).referral_program_id)
      .maybeSingle()
    if (prog && (prog as any).is_active) {
      referralProgram = {
        referrer_reward_text: (prog as any).referrer_reward_text ?? null,
        referrer_image_url: (prog as any).referrer_image_url ?? null,
      }
    }
  }

  // Tenant для брендинга на странице родителя (3.6)
  let tenant: any = null
  if ((album as any)?.tenant_id) {
    const { data: t } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, logo_url, settings')
      .eq('id', (album as any).tenant_id)
      .single()
    if (t) {
      const logoUrl = (t as any).logo_url
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${(t as any).logo_url}`
        : null
      // C2: отдаём родителю только брендинговые ключи, а не весь settings
      // (там могут быть служебные поля).
      const s = (t as any).settings ?? {}
      tenant = {
        name: (t as any).name,
        slug: (t as any).slug,
        logo_url: logoUrl,
        settings: {
          brand_color: s.brand_color ?? null,
          welcome_text: s.welcome_text ?? null,
          footer_text: s.footer_text ?? null,
        },
      }
    }
  }

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
    .gt('expires_at', new Date().toISOString())  // hot-fix: TTL — игнорируем протухшие locks

  const { data: confirmedPortraits } = await supabaseAdmin
    .from('selections')
    .select('photo_id, child_id')
    .in('selection_type', ['portrait_page', 'portrait_cover'])
    .in('photo_id', (allPortraits ?? []).map((p: any) => p.id))

  const portraitLockedByOther = new Set([
    ...(portraitLocks ?? []).filter((l: any) => l.child_id !== child.id).map((l: any) => l.photo_id),
    ...(confirmedPortraits ?? []).filter((s: any) => s.child_id !== child.id).map((s: any) => s.photo_id),
  ])

  const portraits = await Promise.all((allPortraits ?? []).map(async (p: any) => ({
    ...p,
    url: await getPhotoUrl(p.storage_path),
    thumb: await getThumbUrl(p.storage_path, (p as any).thumb_path ?? null),
    locked: portraitLockedByOther.has(p.id),
  })))

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
    .gt('expires_at', new Date().toISOString())  // hot-fix: TTL — игнорируем протухшие locks

  const { data: confirmedGroups } = await supabaseAdmin
    .from('selections')
    .select('photo_id, child_id')
    .eq('selection_type', 'group')
    .in('photo_id', (groupPhotos ?? []).map((p: any) => p.id))

  const groupLockedByOther = new Set([
    ...(groupLocks ?? []).filter((l: any) => l.child_id !== child.id).map((l: any) => l.photo_id),
    ...(confirmedGroups ?? []).filter((s: any) => s.child_id !== child.id).map((s: any) => s.photo_id),
  ])

  const groups = await Promise.all((groupPhotos ?? []).map(async (p: any) => ({
    ...p,
    url: await getPhotoUrl(p.storage_path),
    thumb: await getThumbUrl(p.storage_path, (p as any).thumb_path ?? null),
    locked: album?.group_exclusive !== false && groupLockedByOther.has(p.id),
  })))

  const [existingSelections, existingContact, existingText, existingCover, existingCoverChoice] = await Promise.all([
    supabaseAdmin.from('selections').select('photo_id, selection_type').eq('child_id', child.id),
    supabaseAdmin.from('parent_contacts').select('parent_name, phone, referral').eq('child_id', child.id).maybeSingle(),
    supabaseAdmin.from('student_texts').select('text').eq('child_id', child.id).maybeSingle(),
    supabaseAdmin.from('cover_selections').select('cover_option, photo_id, surcharge').eq('child_id', child.id).maybeSingle(),
    // НОВАЯ система: выбор обложки (cover_choices). Используется если галерея активна.
    supabaseAdmin.from('cover_choices').select('cover_id, cover_type, photo_option, surcharge').eq('child_id', child.id).maybeSingle(),
  ])

  // Галерея обложек для родителя (НОВАЯ система). active=false → старый поток.
  const coverGallery = await buildCoverGallery(supabaseAdmin, child.album_id, child.id)

  // Загружаем цитаты если это альбом 9-11 класса
  let quotes: any[] = []
  let takenQuoteIds: string[] = []
  if ((album as any)?.text_type === 'grade11') {
    // Цитаты: свои tenant'а + глобальные (3.6)
    const tenantId = (album as any).tenant_id
    let quotesQuery = supabaseAdmin.from('quotes').select('id, text, category').order('category').order('created_at')
    if (tenantId) {
      quotesQuery = quotesQuery.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    } else {
      quotesQuery = quotesQuery.is('tenant_id', null)
    }
    const [quotesRes, takenRes] = await Promise.all([
      quotesQuery,
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
    child, album, tenant, portraits, groups, referralProgram, referral: existingContact.data?.referral ?? null,
    quotes, takenQuoteIds,
    selectedQuoteId: myQuote.data?.quote_id ?? null,
    coverGallery,
    existing: {
      selections: existingSelections.data ?? [],
      contact: existingContact.data,
      text: existingText.data?.text ?? '',
      cover: existingCover.data,
      coverChoice: existingCoverChoice.data,
    },
  })
}
