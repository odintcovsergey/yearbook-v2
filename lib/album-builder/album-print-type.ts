/**
 * resolveAlbumEffectivePrintType — серверный резолв типа переплёта альбома
 * с обращением к БД за fallback'ом на пресет.
 *
 * Это «толстая» обёртка над чистым resolvePrintType (print-type-resolver.ts):
 * приоритет тот же (albums.print_type > preset.print_type > 'layflat'), но
 * сама достаёт print_type связанного пресета из БД, когда у альбома он не
 * задан явно.
 *
 * Зачем helper: эта логика нужна минимум в двух местах одинаково —
 *   - GET album в /api/tenant (РЭ.27.4) — отдаёт effective_print_type в UI
 *     (layout viewer показывает форзацы soft-альбома);
 *   - PDF-экспорт в /api/layout — segmentToSpreads должен сегментировать
 *     страницы с тем же softShift, что и редактор, иначе зеркало/фоны
 *     садятся на разные стороны в превью и PDF (parity-баг soft-альбомов).
 * Раньше блок был заинлайнен в /api/tenant; вынос убирает дубль и делает
 * резолв единым источником правды.
 *
 * ⚠️ Пресет лежит в ОДНОЙ из двух разных таблиц (открыто 21.05.2026):
 *   - section_structure_preset_id → таблица `presets` (связь по uuid `id`);
 *   - config_preset_id            → таблица `config_presets` (legacy, по `slug`).
 * Это РАЗНЫЕ таблицы с разными ключами — не перепутать.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePrintType } from './print-type-resolver';
import type { PrintType } from './types';

/** Поля альбома, нужные для резолва типа переплёта. */
export type AlbumPrintTypeFields = {
  print_type?: string | null;
  section_structure_preset_id?: string | null;
  config_preset_id?: string | null;
};

function asPrintType(value: unknown): PrintType | null {
  return value === 'layflat' || value === 'soft' ? value : null;
}

/**
 * Возвращает effective print_type альбома: явный albums.print_type, иначе
 * print_type связанного пресета, иначе 'layflat'.
 *
 * Не бросает на сбое запроса к пресету — деградирует к резолву по тому, что
 * есть (в худшем случае 'layflat'), как и инлайновый предшественник.
 */
export async function resolveAlbumEffectivePrintType(
  supabase: SupabaseClient,
  album: AlbumPrintTypeFields | null | undefined,
): Promise<PrintType> {
  if (!album) return 'layflat';

  const albumPt = asPrintType(album.print_type);
  if (albumPt) return albumPt;

  // Альбом тип явно не задал — смотрим в связанный пресет.
  let presetPt: PrintType | null = null;
  if (album.section_structure_preset_id) {
    const { data } = await supabase
      .from('presets')
      .select('print_type')
      .eq('id', album.section_structure_preset_id)
      .maybeSingle();
    presetPt = asPrintType((data as { print_type?: string | null } | null)?.print_type);
  } else if (album.config_preset_id) {
    const { data } = await supabase
      .from('config_presets')
      .select('print_type')
      .eq('slug', album.config_preset_id)
      .maybeSingle();
    presetPt = asPrintType((data as { print_type?: string | null } | null)?.print_type);
  }

  return resolvePrintType(albumPt, presetPt);
}
