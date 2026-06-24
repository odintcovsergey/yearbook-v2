/**
 * Пере-подпись фото-значений обложки (серверный модуль — тянет getPhotoUrl).
 *
 * Грабля: редактор обложек раньше сохранял в cover_edits.data ПОДПИСАННЫЕ
 * presigned-URL фото (со сроком 24ч) вместо storage-ключей. Через сутки подпись
 * протухает → битый портрет/логотип в превью. Та же беда, что с вшитыми signed-
 * URL в разворотах (см. память про переезд на Timeweb).
 *
 * Решение: storage-ключ хранить, а подписывать при ЧТЕНИИ. Этот модуль:
 *  - читает: пере-подписывает значение (ключ ИЛИ протухший URL → свежий signed);
 *  - пишет: photoKeyFromUrl извлекает ключ для сохранения вместо URL.
 *
 * Фон обложки (__bg__) сюда НЕ входит — он в бакете template-backgrounds и
 * резолвится отдельно через resolveReadUrl/signCoverBg.
 */
import { getPhotoUrl } from '@/lib/supabase'

/** Фото-метки cover-данных (бакет photos). Остальные метки — текст. */
export const COVER_PHOTO_LABELS = [
  'cover_portrait',
  'cover_common_photo',
  'back_common_photo',
  'back_logo',
  'back_qr',
] as const

/**
 * Извлечь storage-ключ из подписанного/публичного URL фото. Поддерживает:
 *  - Supabase: /storage/v1/object/(public|sign)/<bucket>/<key>
 *  - Timeweb / Yandex path-style: <host>/<bucket>/<key> (s3.twcstorage.ru,
 *    storage.yandexcloud.net)
 *  - Yandex virtual-hosted: <bucket>.storage.yandexcloud.net/<key>
 * Возвращает null, если это не похоже на storage-URL (тогда значение не трогаем).
 */
export function photoKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const supa = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+)$/)
    if (supa) return decodeURIComponent(supa[1])
    const segs = u.pathname.split('/').filter(Boolean)
    if (u.hostname.endsWith('twcstorage.ru') || u.hostname.startsWith('storage.')) {
      return segs.length > 1 ? decodeURIComponent(segs.slice(1).join('/')) : null
    }
    if (u.hostname.includes('yandexcloud.net')) {
      return segs.length ? decodeURIComponent(segs.join('/')) : null
    }
    return null
  } catch {
    return null
  }
}

/**
 * ЧТЕНИЕ: свежо подписать одно фото-значение. Ключ → signed; протухший URL →
 * достаём ключ и подписываем заново; незнакомый URL/none/пусто — как есть.
 */
export async function resignCoverPhotoValue(
  value: string | null | undefined,
): Promise<string | null> {
  if (!value || value === 'none') return value ?? null
  if (!/^https?:\/\//.test(value)) return await getPhotoUrl(value) // уже ключ
  const key = photoKeyFromUrl(value)
  if (!key) return value // не наш storage-URL — не трогаем
  return await getPhotoUrl(key)
}

/** ЧТЕНИЕ: вернуть копию cover-данных со свежо подписанными фото-метками. */
export async function resignCoverPhotoData(
  data: Record<string, string | null>,
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = { ...data }
  for (const label of COVER_PHOTO_LABELS) {
    if (label in out) out[label] = await resignCoverPhotoValue(out[label])
  }
  return out
}

/**
 * ЗАПИСЬ: заменить в cover-данных подписанные фото-URL на storage-КЛЮЧИ
 * (чтобы протухание не повторялось). Мутирует копию, текст/служебные ключи и
 * __bg__ не трогает.
 */
export function keyifyCoverPhotoData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data }
  for (const label of COVER_PHOTO_LABELS) {
    const v = out[label]
    if (typeof v === 'string' && /^https?:\/\//.test(v)) {
      const key = photoKeyFromUrl(v)
      if (key) out[label] = key
    }
  }
  return out
}
