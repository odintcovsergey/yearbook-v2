/**
 * РЭ.25: чистый фильтр не-заказчиков для секции students.
 *
 * Выделен в отдельный модуль (без зависимости от @/lib/supabase),
 * чтобы можно было unit-тестировать без env-переменных.
 *
 * Использование внутри buildAlbumInput — после загрузки children
 * из БД, ДО формирования AlbumInput.students[].
 *
 * Контракт:
 * - includeNonPurchasers=true → возвращает все children без фильтра
 *   (мягкий режим, флаг albums.include_non_purchasers).
 * - includeNonPurchasers=false → отсекает детей с is_purchased=false
 *   (строгий режим, default для новых альбомов).
 *
 * Бэк-совместимость: значения is_purchased=undefined/null трактуются
 * как true (ребёнок участвует). Это важно для случаев когда:
 *  - миграция БД не применена ещё (старые альбомы до РЭ.25),
 *  - тестовая фикстура опустила поле,
 *  - SELECT не запросил эту колонку.
 *
 * Архитектура: фильтр здесь, ДО входа в buildAlbum. Engine остаётся
 * чистым, не знает про is_purchased. См. docs/phase-Р25-spec.md §4.
 */
export function filterChildrenByPurchase<
  C extends { is_purchased?: boolean | null },
>(children: C[], includeNonPurchasers: boolean): C[] {
  if (includeNonPurchasers) return children;
  return children.filter((c) => c.is_purchased !== false);
}
