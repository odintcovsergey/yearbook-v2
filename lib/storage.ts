/**
 * Yandex Object Storage client (S3-совместимый)
 * Все фото хранятся в YC. Пути в БД имеют префикс yc:
 *
 * Бакет приватный: чтение только через signed (presigned GET) URL —
 * см. getPhotoSignedUrl. Прямой доступ к байтам на сервере (ZIP/PDF) —
 * через ycGetObjectBuffer (S3 GetObjectCommand, без публичного HTTP).
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  getTwcSignedUrl,
  twcGetObjectBuffer,
  getTwcUploadUrl,
  twcUpload,
  twcDelete,
} from '@/lib/storage-twc'

// Переключатель фото-хранилища: тот же флаг STORAGE_BACKEND, что и у блобов
// (см. lib/blob-storage.ts). Читаем env напрямую, чтобы не тянуть blob-storage
// и не словить цикл импортов (storage → blob-storage → supabase → storage).
// Фото в Timeweb лежат под ТЕМИ ЖЕ ключами, что в Yandex (stripYcPrefix).
function storageBackend(): 'supabase' | 'timeweb' {
  return process.env.STORAGE_BACKEND === 'timeweb' ? 'timeweb' : 'supabase'
}

const YC_ENDPOINT = 'https://storage.yandexcloud.net'
const YC_REGION = 'ru-central1'

export const ycStorage = new S3Client({
  endpoint: YC_ENDPOINT,
  region: YC_REGION,
  credentials: {
    accessKeyId: process.env.YC_ACCESS_KEY_ID!,
    secretAccessKey: process.env.YC_SECRET_ACCESS_KEY!,
  },
})

const BUCKET = () => process.env.YC_BUCKET_NAME ?? 'yearbook-photos'

// Загрузить файл в YC Storage (бакет приватный — без public-read ACL)
export async function ycUpload(
  storagePath: string,
  body: Buffer,
  contentType = 'image/webp'
): Promise<void> {
  if (storageBackend() === 'timeweb') {
    return twcUpload(stripYcPrefix(storagePath), body, contentType)
  }
  await ycStorage.send(new PutObjectCommand({
    Bucket: BUCKET(),
    Key: storagePath,
    Body: body,
    ContentType: contentType,
  }))
}

// Удалить файл из YC Storage
export async function ycDelete(storagePath: string): Promise<void> {
  if (storageBackend() === 'timeweb') {
    return twcDelete(stripYcPrefix(storagePath))
  }
  try {
    await ycStorage.send(new DeleteObjectCommand({
      Bucket: BUCKET(),
      Key: storagePath,
    }))
  } catch {
    // Не бросаем ошибку если файл уже удалён
  }
}

export function isYcPath(storagePath: string): boolean {
  return storagePath?.startsWith('yc:')
}

export function stripYcPrefix(storagePath: string): string {
  return storagePath.startsWith('yc:') ? storagePath.slice(3) : storagePath
}

// Окно стабильности подписи. Время подписи округляется вниз к началу окна,
// поэтому для одного и того же объекта signed URL получается БАЙТ-В-БАЙТ
// одинаковым в течение всего окна → браузер кэширует картинку, а не качает
// её заново при каждом перезапросе данных (выбор портрета, обновление locks).
// 6 часов — компромисс: ссылка живёт долго, но регулярно ротируется.
const SIGN_WINDOW_MS = 6 * 60 * 60 * 1000

/**
 * Signed (presigned GET) URL для чтения объекта приватного бакета.
 * TTL по умолчанию 24 часа — для просмотра в кабинете/родительской странице
 * и скачивания готовых PDF. Ссылка генерится на сервере, в БД НЕ хранится.
 * Годится для любых объектов бакета (фото, thumbnails, PDF).
 *
 * Время подписи фиксируется к началу 6-часового окна (signingDate), а в ответ
 * подмешивается Cache-Control — иначе подпись менялась бы каждую секунду и
 * браузер не мог кэшировать фото (перекачивал всё при каждом заходе/действии).
 */
export async function getPhotoSignedUrl(storagePath: string, expiresIn = 86400): Promise<string> {
  if (!storagePath) return ''
  if (storageBackend() === 'timeweb') {
    return getTwcSignedUrl(stripYcPrefix(storagePath), expiresIn)
  }
  const windowStart = new Date(Math.floor(Date.now() / SIGN_WINDOW_MS) * SIGN_WINDOW_MS)
  const cmd = new GetObjectCommand({
    Bucket: BUCKET(),
    Key: stripYcPrefix(storagePath),
    // 'private' — кэширует только браузер пользователя, не промежуточные CDN
    // (фото детей — персональные данные). max-age = длина окна стабильности.
    ResponseCacheControl: `private, max-age=${Math.floor(SIGN_WINDOW_MS / 1000)}`,
  })
  return getSignedUrl(ycStorage, cmd, { expiresIn, signingDate: windowStart })
}

/**
 * Прямое чтение байтов объекта на сервере (для ZIP/PDF-сборки).
 * Использует креды сервера через S3 GetObjectCommand — публичный HTTP-фетч
 * не нужен, работает на приватном бакете. Бросает ошибку при отсутствии объекта.
 */
export async function ycGetObjectBuffer(storagePath: string): Promise<Buffer> {
  if (storageBackend() === 'timeweb') {
    return twcGetObjectBuffer(stripYcPrefix(storagePath))
  }
  const res = await ycStorage.send(new GetObjectCommand({
    Bucket: BUCKET(),
    Key: stripYcPrefix(storagePath),
  }))
  const bytes = await res.Body!.transformToByteArray()
  return Buffer.from(bytes)
}

// Presigned URL для прямой загрузки в YC с клиента (обход лимита Vercel 4.5 МБ).
// Бакет приватный — без public-read ACL.
export async function getYcUploadUrl(key: string, contentType: string, expiresIn = 3600): Promise<string> {
  if (storageBackend() === 'timeweb') {
    return getTwcUploadUrl(stripYcPrefix(key), contentType, expiresIn)
  }
  const cmd = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(ycStorage, cmd, { expiresIn })
}
