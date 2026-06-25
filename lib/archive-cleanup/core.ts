/**
 * Жизненный цикл архива — ЧИСТОЕ ядро отбора исходников к удалению (Фаза 2,
 * ТЗ docs/tz-archive-lifecycle.md). Без БД и без хранилища — тестируется без сети.
 * Загрузчик/исполнитель — run.ts.
 *
 * КРИТИЧНОЕ: удаляем по `photos.original_path`, НЕ по префиксу `<album_id>/`.
 * ~13% записей делят файлы (клоны ссылаются на storage заказа-источника), и
 * удаление по префиксу либо промахнётся, либо сломает живой клон. Анти-шаринг:
 * оригинал удаляем, ТОЛЬКО если на него не ссылается ни один НЕ-истёкший заказ.
 */

/** Срок жизни исходников архивного заказа (дней от архивации). */
export const DEFAULT_TTL_DAYS = 90;

/** Поля жизненного цикла заказа (из albums). */
export interface AlbumLifecycle {
  id: string;
  archived: boolean;
  /** ISO-строка момента архивации или null (отсчёт не начат). */
  archived_at: string | null;
  keep_originals_forever: boolean;
  /** ISO когда исходники уже удалены, или null. */
  originals_deleted_at: string | null;
}

/** Ссылка записи photos на оригинал. */
export interface PhotoOriginalRef {
  album_id: string;
  original_path: string | null;
}

/**
 * «Истёкший» заказ — кандидат на удаление исходников:
 *   archived И archived_at задан И прошло ≥ ttl дней И не keep_forever И не
 *   удалён ранее. `archived_at = null` → НЕ истёк (защита бэкфилл-заказов: 11
 *   уже-архивных с null не попадут под удаление, пока дату не проставят).
 */
export function isExpiredAlbum(
  a: AlbumLifecycle,
  nowMs: number,
  ttlDays: number = DEFAULT_TTL_DAYS,
): boolean {
  if (!a.archived) return false;
  if (!a.archived_at) return false; // отсчёт не начат
  if (a.keep_originals_forever) return false;
  if (a.originals_deleted_at) return false; // уже почищен
  const archivedMs = Date.parse(a.archived_at);
  if (!Number.isFinite(archivedMs)) return false;
  return nowMs - archivedMs >= ttlDays * 86_400_000;
}

export interface DeletableResult {
  /** Истёкшие заказы, по которым есть что удалять: id → список original_path. */
  byAlbum: Map<string, string[]>;
  /** Все уникальные ключи-оригиналы к удалению (осиротевшие). */
  keys: string[];
  /** Кандидаты, ИСКЛЮЧЁННЫЕ анти-шарингом (их держит не-истёкший заказ). */
  sharedSkipped: string[];
  /** id заказов, которые истекли и попали в обработку (для отметки originals_deleted_at). */
  expiredAlbumIds: string[];
}

/**
 * Считает, какие исходники реально можно удалить.
 *
 * 1) expired = истёкшие заказы (isExpiredAlbum).
 * 2) Анти-шаринг: собираем original_path, на которые ссылается хоть один
 *    НЕ-истёкший заказ (живой / в пределах 90д / keep_forever / archived_at=null
 *    / уже почищенный) — их трогать НЕЛЬЗЯ.
 * 3) К удалению — original_path записей ИСТЁКШИХ заказов, которых НЕТ в защищённых.
 */
export function computeDeletableOriginals(
  albums: AlbumLifecycle[],
  photos: PhotoOriginalRef[],
  nowMs: number,
  ttlDays: number = DEFAULT_TTL_DAYS,
): DeletableResult {
  const expired = new Set(
    albums.filter((a) => isExpiredAlbum(a, nowMs, ttlDays)).map((a) => a.id),
  );

  // Пути, которые держит НЕ-истёкший заказ → защищены (анти-шаринг).
  const protectedPaths = new Set<string>();
  for (const p of photos) {
    if (p.original_path && !expired.has(p.album_id)) protectedPaths.add(p.original_path);
  }

  const byAlbum = new Map<string, Set<string>>();
  const keys = new Set<string>();
  const shared = new Set<string>();
  const touchedAlbums = new Set<string>();

  for (const p of photos) {
    if (!p.original_path) continue;
    if (!expired.has(p.album_id)) continue; // только истёкшие
    if (protectedPaths.has(p.original_path)) {
      shared.add(p.original_path); // делит не-истёкший заказ → не удаляем
      continue;
    }
    if (!byAlbum.has(p.album_id)) byAlbum.set(p.album_id, new Set());
    byAlbum.get(p.album_id)!.add(p.original_path);
    keys.add(p.original_path);
    touchedAlbums.add(p.album_id);
  }

  const byAlbumOut = new Map<string, string[]>();
  byAlbum.forEach((v, k) => byAlbumOut.set(k, Array.from(v)));
  return {
    byAlbum: byAlbumOut,
    keys: Array.from(keys),
    sharedSkipped: Array.from(shared),
    // Истёкшие заказы, чьи оригиналы реально удаляются (для отметки даты).
    // Заказ без своих оригиналов (всё ушло в shared) не помечаем удалённым.
    expiredAlbumIds: Array.from(touchedAlbums),
  };
}
