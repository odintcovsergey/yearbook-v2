-- Фаза А.1.1 — общий раздел альбома: 5 новых категорий photos.type.
--
-- Проблема: альбом не собирается целиком. Существующие категории
-- photos.type ('portrait','group','teacher') покрывают только личные
-- страницы учеников + учительский раздел. Общий раздел альбома
-- (фото класса разной величины в конце книги) НЕ загружается в систему
-- вообще — фотограф вручную верстает его в InDesign по старой схеме.
--
-- Решение (из docs/roadmap-after-phase-3.md, фаза А.1):
-- расширить enum photos.type на 5 новых категорий, соответствующих
-- размерам фото общего раздела:
--   - common_spread   — фото на разворот
--   - common_full     — полностраничное (весь класс на странице)
--   - common_half     — половина страницы (полкласса)
--   - common_quarter  — четверть страницы
--   - common_sixth    — одна шестая страницы
--
-- Категории согласованы с дизайнером 10.05.2026 (см. блок 2 в
-- docs/designer-questions-2026-05-10.md). Backgrounds НЕ загружаются
-- фотографом (часть дизайна template_set, см. уточнение).
--
-- Подход: расширяем CHECK constraint photos.type вместо введения
-- отдельной колонки subtype. Аргументация:
--   - семантически common_* — полноценные категории с разной логикой
--     в album-builder (page_role='common' + разные slot_capacity
--     поля photos_full/half/quarter/sixth/spread)
--   - в коде type используется как плоский enum в switch/filter,
--     расширение не ломает existing usage
--   - storage_path формируется как album_id/{type}/ts_filename.webp —
--     совпадает с целевой архитектурой хранилища
--
-- Связанный код в этом коммите (А.1.2):
--   - app/api/upload/route.ts — ALLOWED_TYPES расширен
--   - app/api/tenant/route.ts — фильтры upload_photo + register_photo
--   - TypeScript type cast в list_photos response
--
-- UI (А.1.3) — 5 новых блоков загрузки в разделе Фото на app/app/page.tsx.
--
-- Builder использует эти фото (А.2) — приходит позже, после готовности
-- А.1. В А.1 фото только загружаются и хранятся, в общий раздел
-- альбома они не попадают автоматически — это задача А.2.
--
-- Идемпотентность: DROP CONSTRAINT IF EXISTS — миграцию можно применить
-- повторно безопасно.

ALTER TABLE photos
  DROP CONSTRAINT IF EXISTS photos_type_check;

ALTER TABLE photos
  ADD CONSTRAINT photos_type_check
  CHECK (type IN (
    'portrait',
    'group',
    'teacher',
    'common_spread',
    'common_full',
    'common_half',
    'common_quarter',
    'common_sixth'
  ));

COMMENT ON COLUMN photos.type IS
  'Категория фото: portrait/group/teacher (личная страница + учительский раздел) | common_spread/full/half/quarter/sixth (общий раздел альбома, builder использует семантические теги мастеров page_role=common + slot_capacity для размещения)';

-- Pre-check (для ручного запуска в SQL Editor — посмотреть текущее
-- распределение и убедиться что миграция применилась):
-- SELECT type, COUNT(*) FROM photos GROUP BY type ORDER BY type;
