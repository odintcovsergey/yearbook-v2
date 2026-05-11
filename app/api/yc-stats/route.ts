/**
 * YC Storage Statistics endpoint (фаза В.2).
 *
 * Считает размер YC bucket через ListObjectsV2 с пагинацией.
 * Возвращает общий размер + разбивку по top-level папкам:
 *   - originals/ — оригиналы фото для печати (Б.1.3)
 *   - exports/   — PDF-экспорты (90 дней)
 *   - delivery/  — готовые файлы от OkeyBook (6 мес)
 *   - portrait/, group/, teacher/, common_*, personal/ — фото альбомов
 *   - другие (logos в tenants/, etc.)
 *
 * Доступ: только superadmin (вызывается с панели /super).
 *
 * Особенности:
 *   - YC bucket может содержать десятки тысяч объектов. ListObjectsV2
 *     ограничен 1000 за запрос, нужна пагинация через ContinuationToken.
 *   - Тяжёлая операция (~30-60 сек на больших бакетах). Не вызывать
 *     часто. UI должен показать loader на время операции.
 *   - Vercel sync timeout 60 сек на free tier — при >50К объектов
 *     может упасть. Pro даёт 300 сек.
 *   - НЕ кэшируем — данные нужны актуальные для принятия решений
 *     (но фронт может локально кэшировать).
 *
 * Структура группировки:
 *   - Папка верхнего уровня: всё до первого '/' после album_id/ или tenant_id/
 *     Примеры: 'album_uuid/originals/file.jpg' → группа 'originals'
 *              'tenants/uuid/logo.webp' → группа 'logos'
 *              'album_uuid/exports/file.pdf' → группа 'exports'
 *
 * Формула стоимости:
 *   total_gb * 1.95 ₽/ГБ/мес (Standard storage в YC, на 11.05.2026)
 *   Это упрощение — реально может быть Cold tier (₽0.65/ГБ) но в
 *   фазе В.3 lifecycle policy ещё не настроена.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthError } from '@/lib/auth'
import { ycStorage } from '@/lib/storage'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Категории top-level папок для группировки. Регулярки применяются
// к Key объекта. Первый матч выигрывает (порядок важен).
const FOLDER_CATEGORIES: Array<{ name: string; match: (key: string) => boolean }> = [
  { name: 'originals',     match: (k) => /\/originals\//.test(k) },
  { name: 'exports',       match: (k) => /\/exports\//.test(k) },
  { name: 'delivery',      match: (k) => /\/delivery\//.test(k) },
  { name: 'personal',      match: (k) => /\/personal\//.test(k) },
  { name: 'portrait',      match: (k) => /\/portrait\//.test(k) },
  { name: 'group',         match: (k) => /\/group\//.test(k) },
  { name: 'teacher',       match: (k) => /\/teacher\//.test(k) },
  { name: 'common',        match: (k) => /\/common_/.test(k) },
  { name: 'tenants',       match: (k) => k.startsWith('tenants/') },
]

type CategoryStats = {
  name: string
  size_bytes: number
  object_count: number
}

type YcStatsResponse = {
  total_size_bytes: number
  total_object_count: number
  total_size_gb: number       // округлённое до 2 знаков
  estimated_cost_rub: number  // total_size_gb * 1.95
  by_category: CategoryStats[]
  scanned_at: string
  pages_scanned: number       // сколько ListObjectsV2 страниц прошли
  truncated: boolean          // не успели до конца (timeout protection)
}

const MAX_PAGES = 100  // 100 × 1000 = 100К объектов max. Защита от timeout.

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['superadmin'])
  if (isAuthError(auth)) return auth

  const bucket = process.env.YC_BUCKET_NAME ?? 'yearbook-photos'

  // Инициализируем категории нулями + "other" для всего что не подошло
  const categoriesMap = new Map<string, CategoryStats>()
  for (const cat of FOLDER_CATEGORIES) {
    categoriesMap.set(cat.name, { name: cat.name, size_bytes: 0, object_count: 0 })
  }
  categoriesMap.set('other', { name: 'other', size_bytes: 0, object_count: 0 })

  let totalSize = 0
  let totalCount = 0
  let continuationToken: string | undefined = undefined
  let pages = 0
  let truncated = false

  try {
    do {
      const res: import('@aws-sdk/client-s3').ListObjectsV2CommandOutput = await ycStorage.send(new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }))

      pages++

      for (const obj of res.Contents ?? []) {
        const key = obj.Key ?? ''
        const size = obj.Size ?? 0
        totalSize += size
        totalCount++

        // Найти категорию
        let matched = false
        for (const cat of FOLDER_CATEGORIES) {
          if (cat.match(key)) {
            const entry = categoriesMap.get(cat.name)!
            entry.size_bytes += size
            entry.object_count++
            matched = true
            break
          }
        }
        if (!matched) {
          const entry = categoriesMap.get('other')!
          entry.size_bytes += size
          entry.object_count++
        }
      }

      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined

      // Защита от timeout — прекращаем после MAX_PAGES страниц
      if (pages >= MAX_PAGES && continuationToken) {
        truncated = true
        break
      }
    } while (continuationToken)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'YC list error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const totalGb = totalSize / (1024 ** 3)
  const result: YcStatsResponse = {
    total_size_bytes: totalSize,
    total_object_count: totalCount,
    total_size_gb: Math.round(totalGb * 100) / 100,
    estimated_cost_rub: Math.round(totalGb * 1.95 * 100) / 100,
    by_category: Array.from(categoriesMap.values())
      .filter((c) => c.object_count > 0)
      .sort((a, b) => b.size_bytes - a.size_bytes),
    scanned_at: new Date().toISOString(),
    pages_scanned: pages,
    truncated,
  }

  return NextResponse.json(result)
}
