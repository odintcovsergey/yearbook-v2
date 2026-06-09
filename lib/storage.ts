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
  await ycStorage.send(new PutObjectCommand({
    Bucket: BUCKET(),
    Key: storagePath,
    Body: body,
    ContentType: contentType,
  }))
}

// Удалить файл из YC Storage
export async function ycDelete(storagePath: string): Promise<void> {
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

/**
 * Signed (presigned GET) URL для чтения объекта приватного бакета.
 * TTL по умолчанию 24 часа — для просмотра в кабинете/родительской странице
 * и скачивания готовых PDF. Ссылка генерится на сервере при каждом запросе,
 * в БД НЕ хранится. Годится для любых объектов бакета (фото, thumbnails, PDF).
 */
export async function getPhotoSignedUrl(storagePath: string, expiresIn = 86400): Promise<string> {
  if (!storagePath) return ''
  const cmd = new GetObjectCommand({
    Bucket: BUCKET(),
    Key: stripYcPrefix(storagePath),
  })
  return getSignedUrl(ycStorage, cmd, { expiresIn })
}

/**
 * Прямое чтение байтов объекта на сервере (для ZIP/PDF-сборки).
 * Использует креды сервера через S3 GetObjectCommand — публичный HTTP-фетч
 * не нужен, работает на приватном бакете. Бросает ошибку при отсутствии объекта.
 */
export async function ycGetObjectBuffer(storagePath: string): Promise<Buffer> {
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
  const cmd = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(ycStorage, cmd, { expiresIn })
}
