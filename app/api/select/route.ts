import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PUT /api/select — временная блокировка/разблокировка фото в процессе выбора
export async function PUT(req: NextRequest) {
  const { token, photoId, action } = await req.json()
  // action: 'lock' | 'unlock'

  const { data: child } = await supabaseAdmin
    .from('children').select('id, submitted_at').eq('access_token', token).single()

  if (!child) return NextResponse.json({ error: 'Не найден' }, { status: 404 })
  if (child.submitted_at) return NextResponse.json({ error: 'Уже подтверждено' }, { status: 409 })

  if (action === 'lock') {
    // Проверить не занято ли уже другим
    const { data: existing } = await supabaseAdmin
      .from('photo_locks').select('child_id').eq('photo_id', photoId).maybeSingle()

    const { data: confirmed } = await supabaseAdmin
      .from('selections')
      .select('child_id')
      .eq('photo_id', photoId)
      .eq('selection_type', 'group')
      .maybeSingle()

    if ((existing && existing.child_id !== child.id) || (confirmed && confirmed.child_id !== child.id))
      return NextResponse.json({ error: 'Фото уже выбрано другим' }, { status: 409 })

    await supabaseAdmin
      .from('photo_locks')
      .upsert({ photo_id: photoId, child_id: child.id }, { onConflict: 'photo_id' })

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
  const { token, parentName, phone, portraitPage, coverOption, portraitCover, studentText, groupPhotos } = body

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
    .select('cover_mode, cover_price, group_enabled, group_min, group_max, text_enabled')
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

  let surcharge = 0
  if (coverOption === 'other') surcharge = album?.cover_price ?? 0

  // Проверить что групповые фото не заняты другими (финальная проверка)
  for (const photoId of groupPhotos) {
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
    { child_id: childId, parent_name: parentName.trim(), phone: phone.trim() },
    { onConflict: 'child_id' }
  )

  // 2. Текст ученика
  await supabaseAdmin.from('student_texts').upsert(
    { child_id: childId, text: (studentText ?? '').slice(0, 500) },
    { onConflict: 'child_id' }
  )

  // 3. Выбор обложки
  await supabaseAdmin.from('cover_selections').upsert(
    { child_id: childId, cover_option: coverOption ?? 'none', photo_id: portraitCover ?? null, surcharge },
    { onConflict: 'child_id' }
  )

  // 4. Выборы фото — сначала удаляем старые
  await supabaseAdmin.from('selections').delete().eq('child_id', childId)

  const selectionRows = [
    { child_id: childId, photo_id: portraitPage, selection_type: 'portrait_page' },
    ...(coverOption === 'other' && portraitCover
      ? [{ child_id: childId, photo_id: portraitCover, selection_type: 'portrait_cover' }]
      : []),
    ...groupPhotos.map((photoId: string) => ({
      child_id: childId, photo_id: photoId, selection_type: 'group'
    })),
  ]

  const { error: selError } = await supabaseAdmin.from('selections').insert(selectionRows)
  if (selError)
    return NextResponse.json({ error: 'Ошибка сохранения: ' + selError.message }, { status: 500 })

  // 5. Удалить временные блокировки этого ребёнка (теперь selections — источник правды)
  await supabaseAdmin.from('photo_locks').delete().eq('child_id', childId)

  // 6. Отметить как подтверждённое
  await supabaseAdmin
    .from('children')
    .update({ submitted_at: new Date().toISOString() })
    .eq('id', childId)

  return NextResponse.json({ ok: true })
}
