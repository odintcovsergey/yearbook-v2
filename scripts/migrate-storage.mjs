/**
 * Миграция фотографий из Supabase Storage в Yandex Object Storage
 *
 * Использование:
 *   node scripts/migrate-storage.mjs            # dry-run — только подсчёт
 *   node scripts/migrate-storage.mjs --execute  # реальная миграция
 *   node scripts/migrate-storage.mjs --execute --batch=50  # размер батча (def: 20)
 *
 * Переменные окружения (можно передать через .env.local или явно):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   YC_ACCESS_KEY_ID
 *   YC_SECRET_ACCESS_KEY
 *   YC_BUCKET_NAME  (default: yearbook-photos)
 *
 * Скрипт:
 *   1. Находит все фото в БД без префикса yc: (старые Supabase-файлы)
 *   2. Для каждого: скачивает из Supabase Storage, заливает в YC,
 *      обновляет storage_path / thumb_path в БД
 *   3. Пропускает уже мигрированные (yc:) и несуществующие файлы
 *   4. В случае ошибки для одного файла — продолжает следующий
 *   5. Никогда не удаляет файлы из Supabase — это делается вручную позже
 */

import { readFileSync, existsSync } from 'fs'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'

// ─── Читаем .env.local если есть ────────────────────────────────────────────
const envPath = new URL('../.env.local', import.meta.url).pathname
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] ??= m[2].replace(/^['"]|['"]$/g, '')
  }
}

// ─── Аргументы ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DRY_RUN = !args.includes('--execute')
const BATCH_SIZE = parseInt(args.find(a => a.startsWith('--batch='))?.split('=')[1] ?? '20')

// ─── Env-проверка ─────────────────────────────────────────────────────────────
const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const YC_KEY_ID      = process.env.YC_ACCESS_KEY_ID
const YC_SECRET      = process.env.YC_SECRET_ACCESS_KEY
const YC_BUCKET      = process.env.YC_BUCKET_NAME ?? 'yearbook-photos'

const missing = []
if (!SUPABASE_URL)  missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!SUPABASE_KEY)  missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (!YC_KEY_ID)     missing.push('YC_ACCESS_KEY_ID')
if (!YC_SECRET)     missing.push('YC_SECRET_ACCESS_KEY')
if (missing.length) {
  console.error('❌ Не хватает переменных окружения:', missing.join(', '))
  console.error('   Создай .env.local в корне проекта или передай через env')
  process.exit(1)
}

// ─── Клиенты ─────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const yc = new S3Client({
  endpoint: 'https://storage.yandexcloud.net',
  region: 'ru-central1',
  credentials: { accessKeyId: YC_KEY_ID, secretAccessKey: YC_SECRET },
})

// ─── Вспомогательные функции ─────────────────────────────────────────────────

/** Скачать файл через /api/img/ прокси (работает из РФ/КЗ). */
async function downloadFromSupabase(storagePath) {
  // Прямой Supabase Storage заблокирован в РФ/КЗ.
  // Качаем через Vercel-прокси — он забирает файл сервер→сервер.
  const url = `https://yearbook-v2.vercel.app/api/img/${storagePath}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Proxy HTTP ${res.status} для ${storagePath}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Проверить, существует ли объект в YC (чтобы не заливать повторно). */
async function ycExists(key) {
  try {
    await yc.send(new HeadObjectCommand({ Bucket: YC_BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

/** Залить буфер в YC. */
async function uploadToYC(key, buffer) {
  await yc.send(new PutObjectCommand({
    Bucket: YC_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/webp',
    ACL: 'public-read',
  }))
}

/** Обновить storage_path (и опционально thumb_path) в БД. */
async function updateDbPaths(photoId, newStoragePath, newThumbPath) {
  const update = { storage_path: newStoragePath }
  if (newThumbPath !== undefined) update.thumb_path = newThumbPath
  const { error } = await supabase
    .from('photos')
    .update(update)
    .eq('id', photoId)
  if (error) throw new Error(`DB update failed: ${error.message}`)
}

/** Мигрировать один путь (storage_path или thumb_path). */
async function migrateOnePath(storagePath, label) {
  if (!storagePath || storagePath.startsWith('yc:')) return { skipped: true }

  // YC ключ = тот же путь, просто без префикса yc:
  const ycKey = storagePath

  // Проверяем, может уже залит в YC (при предыдущем прерванном запуске)
  const alreadyInYC = await ycExists(ycKey)
  if (!alreadyInYC) {
    const buffer = await downloadFromSupabase(storagePath)
    if (!buffer) {
      return { missing: true }
    }
    await uploadToYC(ycKey, buffer)
  }

  return { ycKey, alreadyInYC }
}

// ─── Статистика ───────────────────────────────────────────────────────────────
const stats = {
  total: 0,
  migrated: 0,
  skipped_already_yc: 0,
  skipped_missing: 0,
  errors: 0,
  errors_list: [],
}

// ─── Основная логика ──────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  Миграция фото: Supabase Storage → Yandex Object Storage`)
  console.log(`  Режим: ${DRY_RUN ? '🔍 DRY-RUN (без изменений)' : '🚀 EXECUTE (реальная миграция)'}`)
  console.log(`  Батч: ${BATCH_SIZE} фото`)
  console.log(`${'═'.repeat(60)}\n`)

  // Считаем все фото без yc: (старые)
  const { count, error: countErr } = await supabase
    .from('photos')
    .select('*', { count: 'exact', head: true })
    .not('storage_path', 'like', 'yc:%')

  if (countErr) {
    console.error('❌ Ошибка запроса к БД:', countErr.message)
    process.exit(1)
  }

  stats.total = count ?? 0
  console.log(`📊 Фото для миграции (без yc: префикса): ${stats.total}`)

  if (stats.total === 0) {
    console.log('✅ Все фото уже в Yandex Object Storage — миграция не нужна!')
    return
  }

  if (DRY_RUN) {
    // В dry-run режиме: делаем выборку первых 100 для анализа
    const { data: sample } = await supabase
      .from('photos')
      .select('storage_path, thumb_path')
      .not('storage_path', 'like', 'yc:%')
      .limit(100)

    const withThumb = (sample ?? []).filter(p => p.thumb_path && !p.thumb_path.startsWith('yc:')).length
    const thumbPercent = sample?.length ? Math.round(withThumb / sample.length * 100) : 0

    console.log(`\n📁 Пример путей (первые 5):`)
    ;(sample ?? []).slice(0, 5).forEach(p => {
      console.log(`   storage: ${p.storage_path}`)
      if (p.thumb_path) console.log(`   thumb:   ${p.thumb_path}`)
    })

    console.log(`\n📊 Анализ по выборке из ${sample?.length ?? 0}:`)
    console.log(`   • С отдельным thumb: ~${thumbPercent}%`)
    console.log(`\n⚠️  Это DRY-RUN — реальных изменений не было.`)
    console.log(`   Для запуска миграции: node scripts/migrate-storage.mjs --execute\n`)
    return
  }

  // ─── EXECUTE MODE ────────────────────────────────────────────────────────
  console.log(`\n🔄 Начинаем миграцию ${stats.total} файлов...\n`)

  let offset = 0
  let processed = 0

  while (true) {
    const { data: batch, error: batchErr } = await supabase
      .from('photos')
      .select('id, storage_path, thumb_path, album_id, filename')
      .not('storage_path', 'like', 'yc:%')
      .order('id')
      .range(offset, offset + BATCH_SIZE - 1)

    if (batchErr) {
      console.error('❌ Ошибка выборки батча:', batchErr.message)
      break
    }
    if (!batch || batch.length === 0) break

    for (const photo of batch) {
      processed++
      const prefix = `[${processed}/${stats.total}]`

      try {
        // Мигрируем storage_path
        const mainResult = await migrateOnePath(photo.storage_path, 'main')

        if (mainResult.missing) {
          console.log(`${prefix} ⚠️  Файл не найден в Supabase: ${photo.storage_path}`)
          stats.skipped_missing++
          continue
        }

        // Мигрируем thumb_path если есть
        let newThumbPath = undefined
        if (photo.thumb_path && !photo.thumb_path.startsWith('yc:')) {
          const thumbResult = await migrateOnePath(photo.thumb_path, 'thumb')
          if (!thumbResult.missing) {
            newThumbPath = `yc:${photo.thumb_path}`
          }
        }

        // Обновляем БД
        const newStoragePath = `yc:${photo.storage_path}`
        await updateDbPaths(photo.id, newStoragePath, newThumbPath)

        const note = mainResult.alreadyInYC ? ' (уже был в YC, только обновили БД)' : ''
        console.log(`${prefix} ✅ ${photo.filename ?? photo.storage_path}${note}`)
        stats.migrated++

      } catch (err) {
        const msg = err?.message ?? String(err)
        console.log(`${prefix} ❌ ОШИБКА: ${photo.storage_path} — ${msg}`)
        stats.errors++
        stats.errors_list.push({ path: photo.storage_path, error: msg })
        // Продолжаем — не останавливаемся из-за одного файла
      }
    }

    // Следующий батч — но мы всегда начинаем с начала (offset 0),
    // потому что мигрированные файлы уже не попадут в выборку (yc:)
    // Если были только ошибки — сдвигаемся вперёд чтобы не зациклиться
    if (stats.errors > 0 && stats.migrated === 0) {
      offset += BATCH_SIZE
    }
    // Небольшая пауза чтобы не перегружать API
    await new Promise(r => setTimeout(r, 200))
  }

  // ─── Итоги ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  ИТОГИ МИГРАЦИИ`)
  console.log(`${'═'.repeat(60)}`)
  console.log(`  ✅ Мигрировано:          ${stats.migrated}`)
  console.log(`  ⚠️  Файл не найден:       ${stats.skipped_missing}`)
  console.log(`  ❌ Ошибки:               ${stats.errors}`)
  console.log(`${'═'.repeat(60)}`)

  if (stats.errors > 0) {
    console.log(`\n❌ Файлы с ошибками (${stats.errors}):`)
    stats.errors_list.forEach(e => console.log(`   ${e.path}: ${e.error}`))
  }

  if (stats.migrated > 0 && stats.errors === 0 && stats.skipped_missing === 0) {
    console.log(`\n🎉 Миграция завершена без ошибок!`)
    console.log(`   Теперь можно:`)
    console.log(`   1. Проверить несколько страниц родителей — фото должны грузиться`)
    console.log(`   2. Удалить файлы из Supabase Storage вручную через dashboard`)
    console.log(`   3. Удалить /api/img/ прокси из кода (или оставить — не мешает)`)
  } else if (stats.errors > 0) {
    console.log(`\n⚠️  Были ошибки. Запусти скрипт повторно — успешные пропустятся,`)
    console.log(`   только проблемные повторятся.`)
  }

  console.log('')
}

main().catch(err => {
  console.error('💥 Неожиданная ошибка:', err)
  process.exit(1)
})
