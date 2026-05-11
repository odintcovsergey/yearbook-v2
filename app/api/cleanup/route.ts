/**
 * Cleanup endpoint (фаза В.1) — удаляет просроченные файлы из YC и
 * соответствующие записи из БД.
 *
 * Зачем: lifecycle policy YC (В.3) удалит файлы автоматически, но
 * строки в album_exports и delivery_files останутся висеть.
 * Этот endpoint синхронизирует БД с реальностью.
 *
 * Сейчас он работает в обе стороны: удаляет и файлы из YC, и записи
 * из БД. Поэтому можно его использовать как ЕДИНСТВЕННЫЙ механизм
 * cleanup'а — даже без lifecycle policy YC.
 *
 * Авторизация: секретный токен в env CLEANUP_SECRET, передаётся как
 * Authorization: Bearer <token> или query ?token=<token>.
 * НЕ через обычный JWT — cron-планировщики (Vercel cron, GitHub
 * Actions, cron-job.org, UptimeRobot) обычно не умеют логин по cookie.
 *
 * Способы вызова:
 *   - Vercel cron: добавить в vercel.json (требует Pro план)
 *   - GitHub Actions: schedule trigger + curl
 *   - cron-job.org или UptimeRobot: HTTP-monitor с этим URL
 *   - Вручную: curl -X POST -H "Authorization: Bearer $TOKEN" \
 *              https://yearbook-v2.vercel.app/api/cleanup
 *
 * dry_run параметр:
 *   - ?dry_run=1 → возвращает СПИСОК что было бы удалено, ничего не делает
 *   - без параметра → реально удаляет
 *
 * Использует ycDelete который игнорирует ошибки (если файл уже удалён
 * lifecycle-политикой — это нормально, просто чистим БД).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ycDelete, stripYcPrefix } from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CleanupTarget = {
  id: string
  storage_path: string
  expires_at: string
  album_id: string
  filename?: string
}

type CleanupResult = {
  exports: {
    found: number
    deleted: number
    errors: Array<{ id: string; error: string }>
    items?: CleanupTarget[]  // только в dry_run
  }
  delivery: {
    found: number
    deleted: number
    errors: Array<{ id: string; error: string }>
    items?: CleanupTarget[]  // только в dry_run
  }
  dry_run: boolean
  started_at: string
  finished_at: string
}

export async function POST(req: NextRequest) {
  // Проверка авторизации
  const expectedToken = process.env.CLEANUP_SECRET
  if (!expectedToken) {
    return NextResponse.json(
      { error: 'CLEANUP_SECRET not configured' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const tokenFromHeader = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null
  const tokenFromQuery = req.nextUrl.searchParams.get('token')
  const providedToken = tokenFromHeader ?? tokenFromQuery

  if (providedToken !== expectedToken) {
    // Без error.detail чтобы не сливать информацию атакующему
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1'
  const startedAt = new Date().toISOString()

  // ── 1. album_exports: expires_at < now() ──────────────────────────────
  const { data: expiredExports, error: exportsErr } = await supabaseAdmin
    .from('album_exports')
    .select('id, storage_path, expires_at, album_id, filename')
    .lt('expires_at', startedAt)

  if (exportsErr) {
    return NextResponse.json(
      { error: `album_exports query failed: ${exportsErr.message}` },
      { status: 500 },
    )
  }

  const exportsList = (expiredExports ?? []) as CleanupTarget[]
  const exportsResult: CleanupResult['exports'] = {
    found: exportsList.length,
    deleted: 0,
    errors: [],
    ...(dryRun ? { items: exportsList } : {}),
  }

  if (!dryRun) {
    for (const item of exportsList) {
      try {
        // YC: удаляем файл. ycDelete сам игнорирует ошибки если файла нет.
        await ycDelete(stripYcPrefix(item.storage_path))

        // БД: удаляем запись
        const { error } = await supabaseAdmin
          .from('album_exports')
          .delete()
          .eq('id', item.id)

        if (error) {
          exportsResult.errors.push({ id: item.id, error: error.message })
        } else {
          exportsResult.deleted++
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'unknown error'
        exportsResult.errors.push({ id: item.id, error: msg })
      }
    }
  }

  // ── 2. delivery_files: expires_at < now() ─────────────────────────────
  const { data: expiredDelivery, error: deliveryErr } = await supabaseAdmin
    .from('delivery_files')
    .select('id, storage_path, expires_at, album_id, filename')
    .lt('expires_at', startedAt)

  if (deliveryErr) {
    // Не критично — возвращаем то что успели по exports'ам
    return NextResponse.json(
      {
        error: `delivery_files query failed: ${deliveryErr.message}`,
        partial_result: { exports: exportsResult },
      },
      { status: 500 },
    )
  }

  const deliveryList = (expiredDelivery ?? []) as CleanupTarget[]
  const deliveryResult: CleanupResult['delivery'] = {
    found: deliveryList.length,
    deleted: 0,
    errors: [],
    ...(dryRun ? { items: deliveryList } : {}),
  }

  if (!dryRun) {
    for (const item of deliveryList) {
      try {
        await ycDelete(stripYcPrefix(item.storage_path))

        const { error } = await supabaseAdmin
          .from('delivery_files')
          .delete()
          .eq('id', item.id)

        if (error) {
          deliveryResult.errors.push({ id: item.id, error: error.message })
        } else {
          deliveryResult.deleted++
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'unknown error'
        deliveryResult.errors.push({ id: item.id, error: msg })
      }
    }
  }

  const result: CleanupResult = {
    exports: exportsResult,
    delivery: deliveryResult,
    dry_run: dryRun,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  }

  return NextResponse.json(result)
}

// GET для healthcheck'а (например UptimeRobot ping)
export async function GET() {
  return NextResponse.json({
    ok: true,
    info: 'Use POST with Authorization: Bearer <CLEANUP_SECRET> to run cleanup. Add ?dry_run=1 to preview.',
  })
}
