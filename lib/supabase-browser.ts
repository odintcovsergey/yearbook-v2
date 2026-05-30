import { createClient } from '@supabase/supabase-js'

// Браузерный Supabase-клиент (anon key). Безопасен для клиентского бандла —
// в отличие от lib/supabase.ts, НЕ требует SUPABASE_SERVICE_ROLE_KEY (тот
// упал бы при импорте в браузере).
//
// Используется для прямой загрузки файлов в Storage по подписанной ссылке
// (createSignedUploadUrl на сервере → uploadToSignedUrl в браузере), чтобы
// обойти лимит тела запроса Vercel (~4.5 МБ для serverless-функций).
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
)
