/**
 * Диспетчер хранилища (переезд Supabase Storage → Timeweb S3).
 *
 * Один переключатель STORAGE_BACKEND (по умолчанию 'supabase') решает, куда
 * писать и откуда читать «не-фото» картинки: фоны (template-backgrounds),
 * декор (template-decorations), реферальные картинки (referral-images).
 *
 *   STORAGE_BACKEND=supabase  — текущий прод: публичные бакеты Supabase.
 *   STORAGE_BACKEND=timeweb   — приватный бакет Timeweb, чтение через signed URL.
 *
 * В Timeweb всё лежит в ОДНОМ бакете, имя supabase-бакета становится префиксом
 * пути: key = `<bucket>/<path>` (см. copy в скрипте переезда).
 *
 * Формат хранения в БД:
 *   - фоны хранят относительный путь (key) — режем/собираем легко;
 *   - декор и реф-картинки ИСТОРИЧЕСКИ хранили полный публичный URL Supabase.
 *     Новый код пишет относительный key; resolveReadUrl понимает оба формата
 *     (распознаёт старый supabase-URL и достаёт из него bucket+key).
 *
 * Только сервер (использует supabaseAdmin / креды). В браузерный бандл не тянуть.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { getTwcSignedUrl, twcUpload, twcDelete, twcList, getTwcUploadUrl, twcCopy } from '@/lib/storage-twc'

export type BlobBucket = 'template-backgrounds' | 'template-decorations' | 'referral-images'

export function storageBackend(): 'supabase' | 'timeweb' {
  return process.env.STORAGE_BACKEND === 'timeweb' ? 'timeweb' : 'supabase'
}

const SUPA_PUBLIC_RE = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/

/**
 * Привести сохранённое значение к {bucket, key}.
 * stored может быть:
 *   - относительным ключом (фоны; новый код декора/рефки) → bucket = defaultBucket;
 *   - полным публичным URL Supabase (легаси декор/рефка) → bucket+key из URL.
 */
function splitStored(defaultBucket: BlobBucket, stored: string): { bucket: string; key: string } {
  const m = stored.match(SUPA_PUBLIC_RE)
  if (m) return { bucket: m[1], key: decodeURIComponent(m[2]) }
  return { bucket: defaultBucket, key: stored.replace(/^\/+/, '') }
}

function supabasePublicUrl(bucket: string, key: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${key}`
}

/**
 * Ссылка для ЧТЕНИЯ объекта (отдаётся на фронт / фетчится в PDF).
 * supabase → публичный URL; timeweb → signed URL приватного бакета.
 * Понимает и относительный key, и старый полный supabase-URL.
 */
export async function resolveReadUrl(bucket: BlobBucket, stored: string | null | undefined): Promise<string> {
  if (!stored) return ''
  // Уже подписанный/чужой http(s)-URL не из supabase-public — отдать как есть.
  if (/^https?:\/\//.test(stored) && !SUPA_PUBLIC_RE.test(stored)) return stored
  const { bucket: b, key } = splitStored(bucket, stored)
  if (storageBackend() === 'timeweb') {
    return getTwcSignedUrl(`${b}/${key}`)
  }
  return supabasePublicUrl(b, key)
}

/** Синхронный публичный URL для supabase-режима (там, где async неудобен и backend заведомо supabase). */
export function publicReadUrl(bucket: BlobBucket, stored: string): string {
  const { bucket: b, key } = splitStored(bucket, stored)
  return supabasePublicUrl(b, key)
}

/**
 * Подписать значение ДЛЯ КЛИЕНТА, который сам строит URL из относительного пути
 * (редактор: пул фонов, default-фон, master-override, __bg__, декор).
 *   - supabase → возвращаем как есть (клиент строит публичный URL как раньше) → 0 риска;
 *   - timeweb  → подписанный URL (клиент использует его напрямую, см. http-guard).
 */
export async function signForClient(bucket: BlobBucket, stored: string | null | undefined): Promise<string | null | undefined> {
  if (!stored || storageBackend() !== 'timeweb') return stored
  return resolveReadUrl(bucket, stored)
}

/** Подписать url у декор-плейсхолдеров (timeweb). В supabase — массив без изменений. */
export async function signDecorPlaceholders<T extends { type?: string; url?: string | null }>(
  placeholders: T[] | null | undefined,
): Promise<T[] | null | undefined> {
  if (!Array.isArray(placeholders) || storageBackend() !== 'timeweb') return placeholders
  return Promise.all(
    placeholders.map(async (ph) =>
      ph && ph.type === 'decoration' && ph.url
        ? { ...ph, url: await resolveReadUrl('template-decorations', ph.url) }
        : ph,
    ),
  )
}

/**
 * Что положить В БД после заливки по относительному ключу `key`:
 *   - supabase → полный публичный URL (как исторически — читатели не ломаются);
 *   - timeweb  → относительный ключ (читатель подпишет через resolveReadUrl).
 * Так переключение безопасно: пропущенный читатель сломает только режим timeweb.
 */
export function storedValue(bucket: BlobBucket, key: string): string {
  if (storageBackend() === 'timeweb') return key
  return supabasePublicUrl(bucket, key)
}

/**
 * Загрузка файла С СЕРВЕРА (buffer уже на сервере, напр. декор из IDML).
 * Возвращает относительный key, который надо сохранить в БД.
 */
export async function serverUpload(
  bucket: BlobBucket,
  key: string,
  body: Buffer,
  contentType: string,
  client: SupabaseClient = supabaseAdmin,
): Promise<string> {
  if (storageBackend() === 'timeweb') {
    await twcUpload(`${bucket}/${key}`, body, contentType)
  } else {
    const { error } = await client.storage.from(bucket).upload(key, body, { contentType, upsert: true })
    if (error) throw new Error(`Failed to upload ${bucket}/${key}: ${error.message}`)
  }
  return key
}

export type UploadTarget =
  | { backend: 'supabase'; path: string; token: string }
  | { backend: 'timeweb'; path: string; put_url: string }

/**
 * Цель для ПРЯМОЙ загрузки С КЛИЕНТА (обход лимита тела Vercel).
 * supabase → token для uploadToSignedUrl; timeweb → presigned PUT URL.
 * Клиент ветвится по полю backend (см. lib/blob-upload-client.ts).
 */
export async function createUploadTarget(
  bucket: BlobBucket,
  key: string,
  contentType: string,
): Promise<UploadTarget> {
  if (storageBackend() === 'timeweb') {
    const put_url = await getTwcUploadUrl(`${bucket}/${key}`, contentType)
    return { backend: 'timeweb', path: key, put_url }
  }
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(key)
  if (error || !data) throw new Error(error?.message ?? 'sign failed')
  return { backend: 'supabase', path: key, token: data.token }
}

/** Удалить объекты (массив относительных ключей). */
export async function removeBlobs(bucket: BlobBucket, keys: string[]): Promise<void> {
  if (keys.length === 0) return
  if (storageBackend() === 'timeweb') {
    await Promise.all(keys.map((k) => twcDelete(`${bucket}/${k}`)))
  } else {
    await supabaseAdmin.storage.from(bucket).remove(keys)
  }
}

/** Скопировать объект внутри бакета (srcKey/dstKey — относительные ключи). */
export async function copyBlob(bucket: BlobBucket, srcKey: string, dstKey: string): Promise<void> {
  if (storageBackend() === 'timeweb') {
    await twcCopy(`${bucket}/${srcKey}`, `${bucket}/${dstKey}`)
  } else {
    const { error } = await supabaseAdmin.storage.from(bucket).copy(srcKey, dstKey)
    if (error) throw new Error(error.message)
  }
}

/** Список относительных ключей по префиксу. */
export async function listBlobs(bucket: BlobBucket, prefix: string): Promise<string[]> {
  if (storageBackend() === 'timeweb') {
    const full = await twcList(`${bucket}/${prefix}`)
    const cut = `${bucket}/`
    return full.map((k) => (k.startsWith(cut) ? k.slice(cut.length) : k))
  }
  const { data } = await supabaseAdmin.storage.from(bucket).list(prefix)
  return (data ?? []).map((f) => `${prefix.replace(/\/$/, '')}/${f.name}`)
}
