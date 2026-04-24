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

// Фото отдаются через /api/img/... прокси на Vercel —
// прямой доступ к supabase.co заблокирован в РФ/Казахстане без VPN
export function getPhotoUrl(storagePath: string): string {
  if (!storagePath) return ''
  return `/api/img/${storagePath}`
}

export function getThumbUrl(storagePath: string, thumbPath: string | null): string {
  if (thumbPath) return `/api/img/${thumbPath}`
  return `/api/img/${storagePath}`
}
