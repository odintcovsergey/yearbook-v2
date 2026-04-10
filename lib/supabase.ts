import { createClient } from '@supabase/supabase-js'

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

// Серверный клиент — полный доступ, только в API routes
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false }, global: { fetch: (url, opts) => fetch(url, { ...opts, cache: 'no-store' }) } }
)

// Публичный клиент — для браузера (ограниченный)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export function getPhotoUrl(storagePath: string, thumb = false): string {
  const base = supabaseAdmin.storage.from('photos').getPublicUrl(storagePath).data.publicUrl
  if (!thumb) return base
  // Supabase image transformation — thumbnail 400px wide
  return base + '?width=400&quality=70'
}
