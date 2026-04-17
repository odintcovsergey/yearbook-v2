import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin', 'owner', 'manager'])
  if (isAuthError(auth)) return auth

  const { album_id, filename, storage_path, type } = await req.json()

  if (!album_id || !filename || !storage_path || !type)
    return NextResponse.json({ error: 'Не хватает данных' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('photos')
    .insert({ album_id, filename, storage_path, type })
    .select()
    .single()

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
