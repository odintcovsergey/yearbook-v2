import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/api-error'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PUT /api/select — временная блокировка/разблокировка фото в процессе выбора
// + установка children.is_purchased (РЭ.25 — родитель может включать/выключать
//   заказ альбома в любой момент, даже после submitted_at).
export async function PUT(req: NextRequest) {
  const { token, photoId, action, value } = await req.json()
  // action: 'lock' | 'unlock' | 'set_purchased'

  const { data: child } = await supabaseAdmin
    .from('children').select('id, submitted_at').eq('access_token', token).single()

  if (!child) return NextResponse.json({ error: 'Не найден' }, { status: 404 })

  // РЭ.25: set_purchased доступен ВСЕГДА, даже при submitted_at !== null.
  // Родитель может передумать после отбора фото — это нормальный сценарий.
  if (action === 'set_purchased') {
    if (typeof value !== 'boolean') {
      return NextResponse.json(
        { error: 'value должен быть true или false' },
        { status: 400 },
      )
    }
    const { error } = await supabaseAdmin
      .from('children')
      .update({ is_purchased: value })
      .eq('id', child.id)
    if (error) {
      return serverError(error, 'select')
    }
    return NextResponse.json({ ok: true, is_purchased: value })
  }

  // lock/unlock — блокируется submitted_at (как до РЭ.25).
  if (child.submitted_at) return NextResponse.json({ error: 'Уже подтверждено' }, { status: 409 })

  if (action === 'lock') {
    // TTL для photo_locks: 15 минут с момента создания/обновления.
    // Hot-fix 10.05.2026 — sweep нашёл orphan locks в проде.
    // Lock с expires_at < now() игнорируется (фото снова доступно),
    // sweep cron не требуется.
    const expiresAtIso = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    const nowIso = new Date().toISOString()

    // Проверить не занято ли уже другим — игнорируем протухшие locks.
    const { data: existing } = await supabaseAdmin
      .from('photo_locks')
      .select('child_id')
      .eq('photo_id', photoId)
      .gt('expires_at', nowIso)
      .maybeSingle()

    const { data: confirmed } = await supabaseAdmin
      .from('selections')
      .select('child_id')
      .eq('photo_id', photoId)
      .eq('selection_type', 'group')
      .maybeSingle()

    if ((existing && existing.child_id !== child.id) || (confirmed && confirmed.child_id !== child.id))
      return NextResponse.json({ error: 'Фото уже выбрано другим' }, { status: 409 })

    // Upsert обновляет locked_at и expires_at — так heartbeat работает
    // бесплатно: фронт может вызывать lock повторно для refresh TTL.
    await supabaseAdmin
      .from('photo_locks')
      .upsert(
        {
          photo_id: photoId,
          child_id: child.id,
          locked_at: nowIso,
          expires_at: expiresAtIso,
        },
        { onConflict: 'photo_id' }
      )

  } else if (action === 'unlock') {
    await supabaseAdmin
      .from('photo_locks')
      .delete()
      .eq('photo_id', photoId)
      .eq('child_id', child.id)
  }

  return NextResponse.json({ ok: true })
}

// POST /api/select — финальное сохранение всего выбора
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { token, parentName, phone, portraitPage, coverOption, portraitCover, studentText, groupPhotos, referral, coverId, coverType } = body

  if (!token) return NextResponse.json({ error: 'Токен не указан' }, { status: 400 })

  const { data: child } = await supabaseAdmin
    .from('children')
    .select('id, submitted_at, album_id')
    .eq('access_token', token)
    .single()

  if (!child) return NextResponse.json({ error: 'Токен не найден' }, { status: 404 })
  if (child.submitted_at) return NextResponse.json({ error: 'Выбор уже сохранён' }, { status: 409 })

  // Получить данные альбома для валидации и расчёта
  const { data: album } = await supabaseAdmin
    .from('albums')
    .select('cover_mode, cover_price, cover_portrait_charge, group_enabled, group_min, group_max, group_exclusive, text_enabled')
    .eq('id', child.album_id).single()

  // Валидация
  if (!parentName?.trim()) return NextResponse.json({ error: 'Укажите имя родителя' }, { status: 400 })
  if (!phone?.trim()) return NextResponse.json({ error: 'Укажите телефон' }, { status: 400 })
  if (!portraitPage) return NextResponse.json({ error: 'Выберите портрет для страницы' }, { status: 400 })
  if (album?.group_enabled) {
    const gMin = album?.group_min ?? 2
    const gMax = album?.group_max ?? 2
    if (!Array.isArray(groupPhotos) || groupPhotos.length < gMin || groupPhotos.length > gMax) {
      const msg = gMin === gMax
        ? `Выберите ровно ${gMin} фото с друзьями`
        : `Выберите от ${gMin} до ${gMax} фото с друзьями`
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }

  // Доплата за портрет на обложке.
  // НОВАЯ система (выбрана обложка из галереи, coverId задан): правило из
  // album.cover_portrait_charge. СТАРАЯ (coverId нет): доплата за «другое фото».
  const price = album?.cover_price ?? 0
  let surcharge = 0
  if (coverId) {
    if (coverType === 'portrait_photo') {
      const charge = (album as any)?.cover_portrait_charge
      if (charge === 'any_portrait') surcharge = price
      else if (charge === 'different_photo' && coverOption === 'other') surcharge = price
    }
  } else if (coverOption === 'other') {
    surcharge = price
  }

  // Проверить что групповые фото не заняты другими (финальная проверка, только если exclusive)
  for (const photoId of (album?.group_exclusive !== false ? groupPhotos : [])) {
    const { data: confirmedByOther } = await supabaseAdmin
      .from('selections')
      .select('child_id')
      .eq('photo_id', photoId)
      .eq('selection_type', 'group')
      .neq('child_id', child.id)
      .maybeSingle()

    if (confirmedByOther)
      return NextResponse.json({ error: 'Одно из выбранных фото только что заняли. Выберите другое.' }, { status: 409 })
  }

  // Сохраняем всё в одной транзакции (последовательно)
  const childId = child.id

  // 1. Контакт родителя
  await supabaseAdmin.from('parent_contacts').upsert(
    { child_id: childId, parent_name: parentName.trim(), phone: phone.trim(), referral: referral?.trim() || null },
    { onConflict: 'child_id' }
  )

  // 2. Текст ученика
  await supabaseAdmin.from('student_texts').upsert(
    { child_id: childId, text: (studentText ?? '').slice(0, 500) },
    { onConflict: 'child_id' }
  )

  // 3. Выбор обложки.
  // cover_selections (СТАРАЯ) пишем всегда — на ней живёт CRM/PDF до этапа 4.
  await supabaseAdmin.from('cover_selections').upsert(
    { child_id: childId, cover_option: coverOption ?? 'none', photo_id: portraitCover ?? null, surcharge },
    { onConflict: 'child_id' }
  )
  // cover_choices (НОВАЯ) — только когда родитель выбрал обложку из галереи.
  // photo_option хранит «то же/другое» для портретной обложки.
  if (coverId) {
    const photoOption = coverType === 'portrait_photo'
      ? (coverOption === 'other' ? 'other' : 'same')
      : null
    await supabaseAdmin.from('cover_choices').upsert(
      {
        child_id: childId,
        cover_id: coverId,
        cover_type: coverType ?? null,
        photo_option: photoOption,
        surcharge,
        paid_personalization: surcharge > 0,
      },
      { onConflict: 'child_id' }
    )
  }

  // 4. Выборы фото — сначала удаляем старые
  await supabaseAdmin.from('selections').delete().eq('child_id', childId)

  // Проверить что все выбранные фото существуют в базе
  const allPhotoIds = [portraitPage, ...(coverOption === 'other' && portraitCover ? [portraitCover] : []), ...groupPhotos]
  const { data: existingPhotos } = await supabaseAdmin.from('photos').select('id').in('id', allPhotoIds)
  const existingPhotoIds = new Set((existingPhotos ?? []).map((p: any) => p.id))

  if (!existingPhotoIds.has(portraitPage))
    return NextResponse.json({ error: 'Выбранный портрет был удалён. Пожалуйста, выберите другое фото.' }, { status: 400 })

  const validGroupPhotos = groupPhotos.filter((id: string) => existingPhotoIds.has(id))
  if (album?.group_enabled) {
    const gMin = album?.group_min ?? 2
    if (validGroupPhotos.length < gMin)
      return NextResponse.json({ error: 'Одно из выбранных фото с друзьями было удалено. Пожалуйста, выберите другое.' }, { status: 400 })
  }

  const selectionRows = [
    { child_id: childId, photo_id: portraitPage, selection_type: 'portrait_page' },
    ...(coverOption === 'other' && portraitCover && existingPhotoIds.has(portraitCover) && portraitCover !== portraitPage
      ? [{ child_id: childId, photo_id: portraitCover, selection_type: 'portrait_cover' }]
      : []),
    ...validGroupPhotos.map((photoId: string) => ({
      child_id: childId, photo_id: photoId, selection_type: 'group'
    })),
  ]

  const { error: selError } = await supabaseAdmin.from('selections').insert(selectionRows)
  if (selError)
    return serverError(selError, 'select')

  // 6. Удалить временные блокировки этого ребёнка (теперь selections — источник правды)
  await supabaseAdmin.from('photo_locks').delete().eq('child_id', childId)

  // 7. Отметить как подтверждённое
  await supabaseAdmin
    .from('children')
    .update({ submitted_at: new Date().toISOString() })
    .eq('id', childId)

  // 8. Проверить — все ли ученики завершили?
  //    Если да — перевести альбом в workflow_status = 'ready'
  try {
    const { data: allChildren } = await supabaseAdmin
      .from('children')
      .select('id, submitted_at')
      .eq('album_id', child.album_id)

    const total = allChildren?.length ?? 0
    const done = allChildren?.filter(c => c.submitted_at).length ?? 0

    if (total > 0 && done === total) {
      await supabaseAdmin
        .from('albums')
        .update({ workflow_status: 'ready' })
        .eq('id', child.album_id)
        .in('workflow_status', ['active']) // только если ещё не передан дальше
    }
  } catch {
    // Некритичная ошибка — не блокируем ответ родителю
  }

  return NextResponse.json({ ok: true })
}
