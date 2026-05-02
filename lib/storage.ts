/**
 * Yandex Object Storage client (S3-совместимый)
 * Все фото хранятся в YC. Пути в БД имеют префикс yc:
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

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

// Публичный базовый URL для файлов в бакете
export function ycPhotoUrl(storagePath: string): string {
  if (!storagePath) return ''
  return `${YC_ENDPOINT}/${BUCKET()}/${storagePath}`
}

// Загрузить файл в YC Storage
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
    // Публичный доступ на чтение
    ACL: 'public-read',
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

// Все пути теперь yc: — прокси /api/img/ удалён (миграция завершена 02.05.2026)
export function getPhotoUrlUniversal(storagePath: string): string {
  if (!storagePath) return ''
  return ycPhotoUrl(stripYcPrefix(storagePath))
}
