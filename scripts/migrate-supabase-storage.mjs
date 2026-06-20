/**
 * Переезд Supabase Storage → Timeweb S3 (КОПИЕЙ, источник не трогаем).
 * Запуск: node --env-file=.env.local scripts/migrate-supabase-storage.mjs [--list|--copy]
 *
 * Каждый supabase-бакет ложится в Timeweb под префикс <bucket>/<path>
 * (структура путей сохраняется). Бакеты Supabase публичные — качаем по public URL.
 */
import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const MODE = process.argv.includes('--copy') ? 'copy' : 'list'
const TARGET_BUCKETS = ['template-backgrounds', 'template-decorations', 'decoration', 'referral-images', 'referrer', 'invitee']

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const s3 = new S3Client({
  endpoint: process.env.TWC_S3_ENDPOINT,
  region: process.env.TWC_S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.TWC_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.TWC_S3_SECRET_ACCESS_KEY,
  },
})
const TW_BUCKET = process.env.TWC_S3_BUCKET
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

// Рекурсивный обход бакета: возвращает [{path, size}]
async function listAll(bucket, prefix = '') {
  const out = []
  let offset = 0
  for (;;) {
    const { data, error } = await supa.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    if (!data || data.length === 0) break
    for (const item of data) {
      const full = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id === null) {
        // папка → рекурсия
        out.push(...(await listAll(bucket, full)))
      } else {
        out.push({ path: full, size: item.metadata?.size ?? 0 })
      }
    }
    if (data.length < 1000) break
    offset += data.length
  }
  return out
}

async function copyOne(bucket, path) {
  const url = `${SUPA_URL}/storage/v1/object/public/${bucket}/${encodeURI(path)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${bucket}/${path}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
  await s3.send(new PutObjectCommand({ Bucket: TW_BUCKET, Key: `${bucket}/${path}`, Body: buf, ContentType: contentType }))
  return buf.length
}

const summary = []
for (const bucket of TARGET_BUCKETS) {
  let files
  try {
    files = await listAll(bucket)
  } catch (e) {
    if (/not.*found|does not exist|Bucket not found/i.test(String(e))) {
      summary.push({ bucket, exists: false })
      continue
    }
    throw e
  }
  const totalBytes = files.reduce((s, f) => s + (f.size || 0), 0)
  let copied = 0
  let copiedBytes = 0
  const errors = []
  if (MODE === 'copy') {
    for (const f of files) {
      try {
        copiedBytes += await copyOne(bucket, f.path)
        copied++
      } catch (e) {
        errors.push(String(e))
      }
    }
  }
  summary.push({ bucket, exists: true, files: files.length, totalBytes, copied, copiedBytes, errors })
  console.log(`[${bucket}] объектов=${files.length} размер=${(totalBytes / 1024).toFixed(1)}KB` + (MODE === 'copy' ? ` скопировано=${copied} ошибок=${errors.length}` : ''))
}

console.log('\n=== ИТОГ (' + MODE + ') ===')
console.log(JSON.stringify(summary.map((s) => ({ ...s, errors: s.errors?.slice(0, 3) })), null, 2))
