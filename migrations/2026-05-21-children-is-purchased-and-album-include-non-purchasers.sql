-- РЭ.25.1: подготовка БД для галки покупки альбома ребёнком.
--
-- Контекст:
-- В РЭ.25 в систему вводится возможность отметить, что конкретный
-- ребёнок не заказывает выпускной альбом. Engine при сборке альбома
-- не будет создавать для таких детей персональную страницу в секции
-- `students` (личные страницы).
--
-- При этом не-заказчики ОСТАЮТСЯ:
--   • на общих фото класса (секция common),
--   • в виньетке класса (если есть),
--   • в списке учеников (для учёта).
-- Это не «удаление ребёнка из альбома», а «нет персональной страницы».
--
-- Две новых колонки:
--
--   children.is_purchased BOOLEAN DEFAULT true
--     Заказывает ли этот ребёнок альбом. По умолчанию true — это
--     критично для бэк-совместимости: существующие альбомы должны
--     работать как до фазы (все ученики в личном разделе).
--     Меняется из двух мест:
--       - фотограф в /app (форма редактирования ученика),
--       - родитель в /[token] (страница отбора фото).
--     Last-write-wins, никаких блокировок.
--
--   albums.include_non_purchasers BOOLEAN DEFAULT false
--     Переопределение на уровне альбома. По умолчанию false (строгое
--     поведение: не-заказчики НЕ получают личную страницу).
--     При true — фильтр выключен, все ученики получают личную
--     страницу независимо от is_purchased. Нужно когда не-заказчиков
--     мало и фотограф решает не плодить дырки.
--     Меняется только фотографом/админом в форме альбома.
--     Родитель этот флаг не видит.
--
-- Архитектурное место фильтра:
--   lib/smart-fill/build-album-input.ts применяет фильтр ПЕРЕД входом
--   в buildAlbum. Engine остаётся чистым, не знает про is_purchased.
--   См. docs/phase-Р25-spec.md §4.
--
-- Индекс idx_children_is_purchased_album:
--   Для будущих агрегаций «N из M заказали» в карточке альбома
--   (РЭ.25.6) — частый запрос вида
--   SELECT COUNT(*) FILTER (WHERE is_purchased) FROM children
--   WHERE album_id = $1.
--
-- ⚠️ Миграция чисто аддитивная. Существующие записи получают
-- is_purchased=true (default) и include_non_purchasers=false (default).
-- Старый код, не знающий о новых колонках, продолжает работать —
-- он эти колонки не читает и не пишет. Zero-downtime изменение.

-- ─── 1. children.is_purchased ─────────────────────────────────────────────
ALTER TABLE children
ADD COLUMN IF NOT EXISTS is_purchased BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN children.is_purchased IS
  'Заказывает ли этот ребёнок альбом (РЭ.25). По умолчанию true. '
  'Если false и albums.include_non_purchasers=false — ребёнок НЕ '
  'получает персональную страницу в секции students. Остаётся в '
  'common-фото и виньетке. Меняется фотографом в /app и родителем '
  'в /[token], last-write-wins.';

-- ─── 2. albums.include_non_purchasers ─────────────────────────────────────
ALTER TABLE albums
ADD COLUMN IF NOT EXISTS include_non_purchasers BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN albums.include_non_purchasers IS
  'Включать ли не-заказчиков (children.is_purchased=false) в '
  'персональные страницы альбома (РЭ.25). По умолчанию false — '
  'строгое поведение, не-заказчики без личной страницы. При true — '
  'все ученики получают личную страницу независимо от is_purchased. '
  'Меняется только фотографом/админом, родитель не видит.';

-- ─── 3. Индекс для будущих агрегаций ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_children_is_purchased_album
  ON children(album_id, is_purchased);

COMMENT ON INDEX idx_children_is_purchased_album IS
  'Для запросов "N из M заказали" на карточке альбома (РЭ.25.6) '
  'и для будущей аналитики по партнёру/тенанту.';

-- ─── Проверка после применения ────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE (table_name='children'  AND column_name='is_purchased')
--    OR (table_name='albums'    AND column_name='include_non_purchasers')
-- ORDER BY table_name, column_name;
--
-- Ожидание:
--   albums    | include_non_purchasers | boolean | NO | false
--   children  | is_purchased           | boolean | NO | true
--
-- Проверка индекса:
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'children'
--   AND indexname = 'idx_children_is_purchased_album';
--
-- Ожидание: одна строка с определением
--   CREATE INDEX idx_children_is_purchased_album ON public.children
--   USING btree (album_id, is_purchased)
--
-- Проверка бэк-совместимости (все существующие дети заказчики):
-- SELECT COUNT(*) FILTER (WHERE is_purchased = true)  AS purchasers,
--        COUNT(*) FILTER (WHERE is_purchased = false) AS non_purchasers,
--        COUNT(*)                                     AS total
-- FROM children;
--
-- Ожидание: purchasers = total, non_purchasers = 0.
