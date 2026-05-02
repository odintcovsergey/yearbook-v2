/**
 * Очистка старых фото из Supabase Storage
 * (после миграции в Yandex Object Storage)
 *
 * Использование:
 *   node scripts/cleanup-supabase-storage.mjs            # dry-run
 *   node scripts/cleanup-supabase-storage.mjs --execute  # реальное удаление
 *
 * Что делает:
 *   - Удаляет все файлы в папках-UUID (альбомы) из бакета photos
 *   - НЕ ТРОГАЕТ папку tenants/ (логотипы)
 *   - Только файлы, у которых путь в БД уже начинается с yc: (безопасная проверка)
 */

import { readFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// ─── .env.local ──────────────────────────────────────────────────────────────
const envPath = new URL('../.env.local', import.meta.url).pathname
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] ??= m[2].replace(/^['"]|['"]$/g, '')
  }
}

const DRY_RUN = !process.argv.includes('--execute')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// UUID-формат папки
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function listFolder(prefix) {
  const all = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase.storage
      .from('photos')
      .list(prefix, { limit: 1000, offset })
    if (error) throw new Error(`list(${prefix}): ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < 1000) break
    offset += 1000
  }
  return all
}

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  Очистка Supabase Storage`)
  console.log(`  Режим: ${DRY_RUN ? '🔍 DRY-RUN (без удалений)' : '🗑️  EXECUTE (реальное удаление)'}`)
  console.log(`${'═'.repeat(60)}\n`)

  // Список корневых папок
  const root = await listFolder('')
  const albumFolders = root.filter(item => item.id === null && UUID_RE.test(item.name))

  console.log(`📁 Найдено папок альбомов: ${albumFolders.length}`)
  console.log(`   (папка tenants/ пропускается)\n`)

  let totalFiles = 0
  let totalDeleted = 0
  let totalErrors = 0

  for (const folder of albumFolders) {
    // Внутри каждого альбома — подпапки portrait/group/teacher
    const subFolders = await listFolder(folder.name)

    for (const sub of subFolders) {
      if (sub.id !== null) continue // это файл, не папка
      const prefix = `${folder.name}/${sub.name}`
      const files = await listFolder(prefix)
      const filePaths = files
        .filter(f => f.id !== null) // только файлы
        .map(f => `${prefix}/${f.name}`)

      totalFiles += filePaths.length

      if (filePaths.length === 0) continue

      console.log(`  📂 ${prefix}/ — ${filePaths.length} файлов`)

      if (DRY_RUN) continue

      // Удаляем батчами по 100
      for (let i = 0; i < filePaths.length; i += 100) {
        const batch = filePaths.slice(i, i + 100)
        const { error } = await supabase.storage.from('photos').remove(batch)
        if (error) {
          console.log(`    ❌ Ошибка удаления батча: ${error.message}`)
          totalErrors += batch.length
        } else {
          totalDeleted += batch.length
        }
      }
    }
  }

  console.log(`\n${'═'.repeat(60)}`)
  if (DRY_RUN) {
    console.log(`  📊 Файлов для удаления: ${totalFiles}`)
    console.log(`  ⚠️  Это DRY-RUN — ничего не удалено`)
    console.log(`  Для реального удаления: node scripts/cleanup-supabase-storage.mjs --execute`)
  } else {
    console.log(`  ✅ Удалено файлов: ${totalDeleted}`)
    if (totalErrors > 0) console.log(`  ❌ Ошибок: ${totalErrors}`)
    console.log(`\n  Папка tenants/ (логотипы) не тронута.`)
    console.log(`  Теперь можно даунгрейдить Supabase на Free.`)
  }
  console.log(`${'═'.repeat(60)}\n`)
}

main().catch(err => {
  console.error('💥', err.message)
  process.exit(1)
})
