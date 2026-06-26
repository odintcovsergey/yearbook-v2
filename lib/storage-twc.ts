/**
 * Timeweb S3 client (S3-совместимый) — целевое хранилище переезда на РФ-серверы.
 * Образец — lib/storage.ts (Yandex). Бакет приватный: чтение только через
 * signed (presigned GET) URL — см. getTwcSignedUrl. Прямой доступ к байтам на
 * сервере (PDF/ZIP) — через twcGetObjectBuffer.
 *
 * Реквизиты — в .env.local (НЕ в git): TWC_S3_ENDPOINT/REGION/BUCKET/
 * ACCESS_KEY_ID/SECRET_ACCESS_KEY.
 *
 * forcePathStyle=true: Timeweb отдаёт бакет как путь (s3.twcstorage.ru/<bucket>),
 * а не как поддомен — иначе подпись presigned-URL может не сойтись.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const TWC_ENDPOINT = () => process.env.TWC_S3_ENDPOINT ?? 'https://s3.twcstorage.ru'
const TWC_REGION = () => process.env.TWC_S3_REGION ?? 'ru-1'

export const twcStorage = new S3Client({
  endpoint: TWC_ENDPOINT(),
  region: TWC_REGION(),
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.TWC_S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.TWC_S3_SECRET_ACCESS_KEY!,
  },
})

const BUCKET = () => process.env.TWC_S3_BUCKET!

// Загрузить файл в Timeweb S3 (бакет приватный — без public-read ACL).
export async function twcUpload(
  key: string,
  body: Buffer,
  contentType = 'image/webp'
): Promise<void> {
  await twcStorage.send(new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    Body: body,
    ContentType: contentType,
  }))
}

// Удалить файл из Timeweb S3.
export async function twcDelete(key: string): Promise<void> {
  try {
    await twcStorage.send(new DeleteObjectCommand({
      Bucket: BUCKET(),
      Key: key,
    }))
  } catch {
    // Не бросаем ошибку если файл уже удалён
  }
}

// Удалить файл из Timeweb S3 — СТРОГО: бросает при реальной ошибке (сеть/ACL),
// в отличие от twcDelete. Нужно там, где по факту удаления принимается решение
// (например, чистить ли записи БД). DeleteObject идемпотентен — отсутствующий
// объект ошибкой НЕ считается, поэтому повтор после частичного сбоя безопасен.
export async function twcDeleteStrict(key: string): Promise<void> {
  await twcStorage.send(new DeleteObjectCommand({
    Bucket: BUCKET(),
    Key: key,
  }))
}

// Список ключей по префиксу (для замены supabase.storage.list при удалении пачкой).
export async function twcList(prefix: string): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  do {
    const res = await twcStorage.send(new ListObjectsV2Command({
      Bucket: BUCKET(),
      Prefix: prefix,
      ContinuationToken: token,
    }))
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key)
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return keys
}

// Копировать объект внутри бакета (для клонирования дизайна).
export async function twcCopy(srcKey: string, dstKey: string): Promise<void> {
  await twcStorage.send(new CopyObjectCommand({
    Bucket: BUCKET(),
    CopySource: `${BUCKET()}/${srcKey}`,
    Key: dstKey,
  }))
}

// Окно стабильности подписи — как в lib/storage.ts: одинаковый signed URL в
// течение окна, чтобы браузер кэшировал картинку, а не качал заново.
const SIGN_WINDOW_MS = 6 * 60 * 60 * 1000

/**
 * Signed (presigned GET) URL для чтения объекта приватного бакета.
 * TTL по умолчанию 24 часа. Ссылка генерится на сервере, в БД НЕ хранится.
 */
export async function getTwcSignedUrl(key: string, expiresIn = 86400): Promise<string> {
  if (!key) return ''
  const windowStart = new Date(Math.floor(Date.now() / SIGN_WINDOW_MS) * SIGN_WINDOW_MS)
  const cmd = new GetObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ResponseCacheControl: `private, max-age=${Math.floor(SIGN_WINDOW_MS / 1000)}`,
  })
  return getSignedUrl(twcStorage, cmd, { expiresIn, signingDate: windowStart })
}

/**
 * Прямое чтение байтов объекта на сервере (для ZIP/PDF-сборки).
 * Работает на приватном бакете (через креды сервера). Бросает при отсутствии.
 */
export async function twcGetObjectBuffer(key: string): Promise<Buffer> {
  const res = await twcStorage.send(new GetObjectCommand({
    Bucket: BUCKET(),
    Key: key,
  }))
  const bytes = await res.Body!.transformToByteArray()
  return Buffer.from(bytes)
}

/**
 * Presigned PUT URL для прямой загрузки в Timeweb с клиента (обход лимита Vercel
 * 4.5 МБ). Клиент делает обычный fetch(url, {method:'PUT', body:file}).
 * Заменяет Supabase createSignedUploadUrl + uploadToSignedUrl.
 */
export async function getTwcUploadUrl(key: string, contentType: string, expiresIn = 3600): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(twcStorage, cmd, { expiresIn })
}
