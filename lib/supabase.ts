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

import { getPhotoSignedUrl } from '@/lib/storage'

// Фото отдаются через signed (presigned GET) URL из приватного YC-бакета.
// Ссылка генерится на сервере при каждом запросе (TTL 24ч), в БД не хранится.
// Функции async — отсюда волна await по потребителям.
export function getPhotoUrl(storagePath: string): Promise<string> {
  return getPhotoSignedUrl(storagePath)
}

export function getThumbUrl(storagePath: string, thumbPath: string | null): Promise<string> {
  if (thumbPath) return getPhotoSignedUrl(thumbPath)
  return getPhotoSignedUrl(storagePath)
}
