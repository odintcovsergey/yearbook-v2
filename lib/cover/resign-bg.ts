/**
 * Пере-подпись фона обложки (__bg__) — серверный модуль (тянет resolveReadUrl).
 *
 * Грабля переезда на Timeweb: значение __bg__ в cover_edits бывает в РАЗНЫХ
 * формах в зависимости от того, когда правили обложку:
 *   - относительный ключ `album-covers/...` (правки в режиме timeweb) — нормально;
 *   - полный публичный Supabase-URL `.../template-backgrounds/album-covers/...`
 *     (правки ДО переезда) — мёртвый, бакет приватный/host переехал → 404;
 *   - протухший presigned Timeweb-URL `s3.twcstorage.ru/<bucket>/template-
 *     backgrounds/album-covers/...?X-Amz-...` (срок 24ч) → 404.
 *
 * Решение (как с фото-метками, см. resign-photos): из любой формы достаём
 * относительный ключ внутри бакета template-backgrounds и подписываем ЗАНОВО
 * через resolveReadUrl (уважает STORAGE_BACKEND). Так фон грузится у всех.
 */
import { resolveReadUrl } from '@/lib/blob-storage'

/** Бакет фонов (внутрянка + эталонные обложки + ручные фоны обложек заказа). */
const TPL_BG_BUCKET = 'template-backgrounds'

/**
 * Достаёт относительный ключ фона (внутри бакета template-backgrounds) из любого
 * сохранённого значения __bg__:
 *   - относительный ключ → как есть (снимаем ведущий слэш и затесавшийся
 *     bucket-префикс `template-backgrounds/`);
 *   - публичный/подписанный Supabase-URL `.../template-backgrounds/<key>` → <key>;
 *   - presigned Timeweb-URL `<host>/<bucket>/template-backgrounds/<key>` → <key>;
 * null — если это не наш storage (тогда значение не трогаем).
 */
export function coverBgKeyFromValue(value: string): string | null {
  if (!/^https?:\/\//.test(value)) {
    const k = value.replace(/^\/+/, '')
    return k.startsWith(`${TPL_BG_BUCKET}/`) ? k.slice(TPL_BG_BUCKET.length + 1) : k
  }
  try {
    const u = new URL(value)
    const supa = u.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign)\/template-backgrounds\/(.+)$/,
    )
    if (supa) return decodeURIComponent(supa[1])
    // Любой путь, где встречается /template-backgrounds/<key> (Timeweb path-style:
    // /<bucket>/template-backgrounds/<key>).
    const marker = `/${TPL_BG_BUCKET}/`
    const idx = u.pathname.indexOf(marker)
    if (idx >= 0) return decodeURIComponent(u.pathname.slice(idx + marker.length))
    return null
  } catch {
    return null
  }
}

/**
 * ЧТЕНИЕ: свежо подписать значение фона обложки. Ключ / supabase-URL / протухший
 * presigned → рабочий URL текущего бэкенда; 'none'/пусто/чужой URL — как есть.
 */
export async function resignCoverBgValue(
  value: string | null | undefined,
): Promise<string | null> {
  if (!value || value === 'none') return value ?? null
  const key = coverBgKeyFromValue(value)
  if (!key) return value // не наш storage — не трогаем
  return await resolveReadUrl(TPL_BG_BUCKET, key)
}
