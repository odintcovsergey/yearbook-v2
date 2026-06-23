/**
 * Хелперы профиля/имени файла экспорта.
 *
 * Перенесены из app/api/layout/route.ts (были локальными там), чтобы их мог
 * переиспользовать и синхронный путь (роут), и фоновый воркер очереди (ТЗ №2).
 * Логика не менялась — чистый вынос.
 */
import type { ExportProfile } from '@/lib/pdf-export'

/**
 * Маппинг строки из БД export_profiles в типизированный объект.
 * Изолирует кодирующий снаружи модуль (lib/pdf-export) от формата БД.
 */
export function mapExportProfile(row: Record<string, unknown>): ExportProfile {
  return {
    id: String(row.id),
    tenant_id: row.tenant_id ? String(row.tenant_id) : null,
    slug: String(row.slug),
    name: String(row.name),
    is_default: Boolean(row.is_default),
    purpose: row.purpose as ExportProfile['purpose'],
    format: row.format as ExportProfile['format'],
    quality: row.quality as ExportProfile['quality'],
    include_bleed: Boolean(row.include_bleed),
    color_mode: row.color_mode as ExportProfile['color_mode'],
    dpi: Number(row.dpi),
    jpeg_quality: Number(row.jpeg_quality),
    filename_template: String(row.filename_template),
    pages_mode: row.pages_mode as ExportProfile['pages_mode'],
    target_size_mb: row.target_size_mb != null ? Number(row.target_size_mb) : null,
    enabled: Boolean(row.enabled),
    spread_export: Boolean(row.spread_export),
  }
}

/**
 * Slugify имя альбома для filename. Удаляет спецсимволы запрещённые
 * в Windows/macOS/Linux file systems, заменяет пробелы на _.
 * Кириллица сохраняется (современные FS поддерживают).
 *
 * Если результат пустой — возвращает 'album'.
 */
export function slugifyForFilename(name: string): string {
  const cleaned = name.replace(/[\\/:"*?<>|]/g, '').replace(/\s+/g, '_').trim()
  return cleaned || 'album'
}

/**
 * Подстановка переменных в filename_template из export_profiles.
 *
 * Поддерживаемые переменные:
 *   {album_name} {date} {datetime} {ext} {student_name}
 *
 * Неподдержанные — оставляются как есть (для отладки).
 */
export function renderFilename(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
}
