import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET — info about referrer for landing page
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Токен не указан' }, { status: 400 })

  const { data: child } = await supabaseAdmin
    .from('children')
    .select('id, full_name, album_id')
    .eq('access_token', token)
    .single()

  if (!child) return NextResponse.json({ error: 'Ссылка недействительна' }, { status: 404 })

  const { data: album } = await supabaseAdmin
    .from('albums')
    .select('title, city, year, referral_program_id, tenant_id, text_type')
    .eq('id', child.album_id)
    .single()

  // Этап 3: фиксируем переход по реф-ссылке (для аналитики воронки).
  // Fire-and-forget — не блокируем выдачу лендинга, ошибку глотаем.
  void supabaseAdmin.from('referral_visits').insert({
    program_id: (album as any)?.referral_program_id ?? null,
    tenant_id: (album as any)?.tenant_id ?? null,
    referrer_child_id: child.id,
    segment: (album as any)?.text_type ?? null,
  }).then(({ error }) => {
    if (error) console.error('referral_visits insert failed:', error.message)
  })

  // Get parent name if available
  const { data: contact } = await supabaseAdmin
    .from('parent_contacts')
    .select('parent_name')
    .eq('child_id', child.id)
    .maybeSingle()

  const referrerName = contact?.parent_name || child.full_name

  // Реферальная программа альбома (сторона реферала: что видит пришедший по
  // ссылке). Имя реферера показывается всегда отдельным бейджем «Вас
  // рекомендует …», поэтому отдельный заголовок программе не нужен.
  let program: {
    reward_text: string | null
    description: string | null
    image_url: string | null
  } | null = null
  if ((album as any)?.referral_program_id) {
    const { data: prog } = await supabaseAdmin
      .from('referral_programs')
      .select('invitee_reward_text, invitee_description, invitee_image_url, is_active')
      .eq('id', (album as any).referral_program_id)
      .maybeSingle()
    if (prog && (prog as any).is_active) {
      program = {
        reward_text: (prog as any).invitee_reward_text ?? null,
        description: (prog as any).invitee_description ?? null,
        image_url: (prog as any).invitee_image_url ?? null,
      }
    }
  }

  return NextResponse.json({
    referrerName,
    albumTitle: album?.title,
    city: album?.city,
    program,
  })
}

// POST — save new lead
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { token, name, phone, city, school, class_name } = body

  if (!token || !name?.trim() || !phone?.trim())
    return NextResponse.json({ error: 'Заполните имя и телефон' }, { status: 400 })

  const { data: child } = await supabaseAdmin
    .from('children')
    .select('id, album_id')
    .eq('access_token', token)
    .single()

  if (!child) return NextResponse.json({ error: 'Ссылка недействительна' }, { status: 404 })

  // Фиксируем по какой программе пришла заявка (мостик к аналитике Этапа 3)
  // и tenant реферера — иначе заявка не привяжется к партнёру и не покажется
  // в его списке «Заявки» (он фильтруется по tenant_id).
  const { data: album } = await supabaseAdmin
    .from('albums')
    .select('referral_program_id, tenant_id, text_type')
    .eq('id', child.album_id)
    .maybeSingle()

  const { error } = await supabaseAdmin.from('referral_leads').insert({
    referrer_child_id: child.id,
    tenant_id: (album as any)?.tenant_id ?? null,
    program_id: (album as any)?.referral_program_id ?? null,
    segment: (album as any)?.text_type ?? null,
    name: name.trim(),
    phone: phone.trim(),
    city: city?.trim() || null,
    school: school?.trim() || null,
    class_name: class_name?.trim() || null,
    status: 'new',
  })

  if (error) return NextResponse.json({ error: 'Ошибка сохранения' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
