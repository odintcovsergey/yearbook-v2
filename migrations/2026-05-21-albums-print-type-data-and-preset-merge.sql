-- РЭ.27.7: миграция данных + слияние дубль-пресетов config_presets.
--
-- ⚠️ КРИТИЧЕСКАЯ МИГРАЦИЯ — затрагивает живые альбомы и пресеты.
-- ПЕРЕД ПРИМЕНЕНИЕМ: снапшот таблиц albums и config_presets через
-- Supabase Dashboard → Database → Backups, или вручную:
--   pg_dump -t albums -t config_presets <db> > backup-before-27.7.sql
--
-- Контекст:
-- После РЭ.27 тип переплёта (layflat / soft) переехал в albums.print_type.
-- Это позволяет слить дубль-пресеты вида 'standard-layflat' / 'standard-soft'
-- в единственный 'standard' — содержательно они идентичны, отличался
-- только print_type, а теперь это атрибут альбома.
--
-- ───────────────────────────────────────────────────────────────────────────
-- Состояние БД на момент написания миграции (21.05.2026):
-- ───────────────────────────────────────────────────────────────────────────
-- albums.print_type распределение (12 альбомов):
--   layflat: 4 (новые, после копирования preset.print_type при create_album)
--   soft:    2 (новые)
--   NULL:    6 (старые, до появления копирования)
--
-- config_presets: 14 записей = 7 пар (layflat + soft):
--   individual-layflat / individual-soft
--   light-layflat      / light-soft
--   maximum-layflat    / maximum-soft
--   medium-layflat     / medium-soft
--   mini-layflat       / mini-soft
--   standard-layflat   / standard-soft
--   universal-layflat  / universal-soft
--
-- ───────────────────────────────────────────────────────────────────────────
-- ПЛАН МИГРАЦИИ (4 шага):
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- ━━━ ШАГ 1: Заполнение albums.print_type у NULL-альбомов ━━━━━━━━━━━━━━━━━━━
-- Берём значение print_type из связанного config_presets (по slug).
-- ssId-путь (section_structure_preset_id → presets) тоже учитываем —
-- хотя на момент написания таких NULL-альбомов нет (1 альбом с ss-пресетом
-- уже имеет print_type=layflat).
--
-- ВАЖНО: используем 'config_presets', не 'presets' (разные таблицы,
-- см. fix(РЭ.27.4) от 21.05.2026).

UPDATE albums a
SET print_type = cp.print_type
FROM config_presets cp
WHERE a.config_preset_id = cp.slug
  AND a.print_type IS NULL
  AND cp.print_type IS NOT NULL;

-- Тот же UPDATE через новую таблицу presets — для альбомов с
-- section_structure_preset_id. На момент написания таких NULL-альбомов
-- нет, но защищаемся на будущее.
UPDATE albums a
SET print_type = p.print_type
FROM presets p
WHERE a.section_structure_preset_id = p.id
  AND a.print_type IS NULL
  AND p.print_type IS NOT NULL;

-- Контрольная проверка после шага 1:
-- SELECT print_type, COUNT(*) FROM albums GROUP BY print_type ORDER BY print_type;
-- Ожидание:
--   layflat: ≥4 (исходные 4 + сколько-то из 6 NULL)
--   soft:    ≥2 (исходные 2 + сколько-то из 6 NULL)
--   NULL:    0 или близко к нулю (если у пресета был NULL print_type — но это
--            не наш случай, все 14 config_presets имеют значение).

-- ━━━ ШАГ 2: Перепривязка soft → layflat для каждой пары ━━━━━━━━━━━━━━━━━━━
-- Каждый альбом, ссылающийся на soft-вариант пресета, перепривязываем
-- на layflat-вариант. Содержательно пресеты идентичны (та же структура,
-- тот же дизайн), отличался только print_type — он уже в albums.print_type.

UPDATE albums SET config_preset_id = 'individual-layflat'  WHERE config_preset_id = 'individual-soft';
UPDATE albums SET config_preset_id = 'light-layflat'       WHERE config_preset_id = 'light-soft';
UPDATE albums SET config_preset_id = 'maximum-layflat'     WHERE config_preset_id = 'maximum-soft';
UPDATE albums SET config_preset_id = 'medium-layflat'      WHERE config_preset_id = 'medium-soft';
UPDATE albums SET config_preset_id = 'mini-layflat'        WHERE config_preset_id = 'mini-soft';
UPDATE albums SET config_preset_id = 'standard-layflat'    WHERE config_preset_id = 'standard-soft';
UPDATE albums SET config_preset_id = 'universal-layflat'   WHERE config_preset_id = 'universal-soft';

-- Контрольная проверка после шага 2:
-- SELECT config_preset_id, COUNT(*) FROM albums GROUP BY config_preset_id;
-- Ожидание: ни одной строки с *-soft slug'ом.

-- ━━━ ШАГ 3: Удаление осиротевших soft-пресетов ━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- После шага 2 на soft-варианты пресетов никто не ссылается.

DELETE FROM config_presets WHERE slug = 'individual-soft';
DELETE FROM config_presets WHERE slug = 'light-soft';
DELETE FROM config_presets WHERE slug = 'maximum-soft';
DELETE FROM config_presets WHERE slug = 'medium-soft';
DELETE FROM config_presets WHERE slug = 'mini-soft';
DELETE FROM config_presets WHERE slug = 'standard-soft';
DELETE FROM config_presets WHERE slug = 'universal-soft';

-- ━━━ ШАГ 4: Переименование layflat-вариантов — убрать суффикс ━━━━━━━━━━━━━
-- Slug 'standard-layflat' → 'standard'.
-- Name 'Стандарт (твёрдые листы)' → 'Стандарт'.
--
-- Сначала обновляем albums.config_preset_id (он хранит slug — внешний
-- ключ по тексту), потом сам config_presets.slug. Делаем атомарно
-- через CTE-подобный паттерн: одной транзакцией.

-- ─ individual ─
UPDATE albums SET config_preset_id = 'individual' WHERE config_preset_id = 'individual-layflat';
UPDATE config_presets
SET slug = 'individual', name = 'Индивидуальный'
WHERE slug = 'individual-layflat';

-- ─ light ─
UPDATE albums SET config_preset_id = 'light' WHERE config_preset_id = 'light-layflat';
UPDATE config_presets
SET slug = 'light', name = 'Лайт'
WHERE slug = 'light-layflat';

-- ─ maximum ─
UPDATE albums SET config_preset_id = 'maximum' WHERE config_preset_id = 'maximum-layflat';
UPDATE config_presets
SET slug = 'maximum', name = 'Максимум'
WHERE slug = 'maximum-layflat';

-- ─ medium ─
UPDATE albums SET config_preset_id = 'medium' WHERE config_preset_id = 'medium-layflat';
UPDATE config_presets
SET slug = 'medium', name = 'Медиум'
WHERE slug = 'medium-layflat';

-- ─ mini ─
UPDATE albums SET config_preset_id = 'mini' WHERE config_preset_id = 'mini-layflat';
UPDATE config_presets
SET slug = 'mini', name = 'Мини'
WHERE slug = 'mini-layflat';

-- ─ standard ─
UPDATE albums SET config_preset_id = 'standard' WHERE config_preset_id = 'standard-layflat';
UPDATE config_presets
SET slug = 'standard', name = 'Стандарт'
WHERE slug = 'standard-layflat';

-- ─ universal ─
UPDATE albums SET config_preset_id = 'universal' WHERE config_preset_id = 'universal-layflat';
UPDATE config_presets
SET slug = 'universal', name = 'Универсал'
WHERE slug = 'universal-layflat';

-- ━━━ ШАГ 5 (опциональный): обнулить config_presets.print_type ━━━━━━━━━━━━
-- Колонку оставляем (НЕ DROP) — для обратной совместимости с кодом
-- который её ещё читает (напр. в engine для fallback). Но значения
-- проставляем в NULL: тип переплёта теперь в albums.print_type,
-- preset.print_type становится unused legacy-полем.
--
-- НЕ ДЕЛАЕМ этот шаг сейчас — пусть значение 'layflat' останется
-- как корректный fallback для случая когда у альбома albums.print_type=NULL
-- (теоретически такой может появиться через ручной UPDATE).
-- Удалим колонку в отдельной зачистке (потенциально часть РЭ.28+).

-- ━━━ КОНТРОЛЬНЫЕ ПРОВЕРКИ ПОСЛЕ ВСЕЙ МИГРАЦИИ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. В config_presets ровно 7 записей с чистыми slug'ами:
-- SELECT slug, name, print_type FROM config_presets ORDER BY slug;
-- Ожидание:
--   individual | Индивидуальный | layflat
--   light      | Лайт           | layflat
--   maximum    | Максимум       | layflat
--   medium     | Медиум         | layflat
--   mini       | Мини           | layflat
--   standard   | Стандарт       | layflat
--   universal  | Универсал      | layflat

-- 2. Распределение по типам переплёта (12 альбомов):
-- SELECT print_type, COUNT(*) FROM albums GROUP BY print_type;
-- Ожидание: layflat + soft = 12, NULL ≈ 0.

-- 3. Ни одного альбома на старых slug-форматах:
-- SELECT config_preset_id, COUNT(*) FROM albums GROUP BY config_preset_id;
-- Ожидание: только чистые slug ('standard', 'mini', etc.), без -layflat / -soft.

-- 4. Все FK в albums.config_preset_id ссылаются на существующие записи:
-- SELECT a.config_preset_id FROM albums a
-- LEFT JOIN config_presets cp ON a.config_preset_id = cp.slug
-- WHERE a.config_preset_id IS NOT NULL AND cp.slug IS NULL;
-- Ожидание: 0 строк.

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- ⚠️ ПОСЛЕ УСПЕШНОГО ПРИМЕНЕНИЯ В SUPABASE:
-- ───────────────────────────────────────────────────────────────────────────
-- На стороне кода нужно обновить submit-path в форме создания альбома
-- (app/app/page.tsx), который сейчас строит preset_slug как
-- '${form.config_type}-${form.print_type}'. После слияния таких slug'ов
-- больше не существует — нужно отправлять чистый '${form.config_type}'.
-- Это часть подэтапа 27.7 (codе-cleanup, отдельный коммит после
-- применения миграции).
