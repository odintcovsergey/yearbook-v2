-- Фаза РЭ.20.5 — проставление density + sheet_type существующим
-- пресетам и создание mini-hard.
--
-- Контекст: миграция 2026-05-18-presets-total-pages-density-sheet-type.sql
-- добавила колонки total_pages/density/sheet_type. У всех 7 пресетов
-- сейчас density=NULL, sheet_type=NULL.
--
-- Эта миграция проставляет значения там, где они очевидны из имени
-- пресета (Сергей подтвердил 18.05.2026):
--   - standard/universal/medium/light/mini-soft: density совпадает с id
--   - maximum: density остаётся NULL — целый разворот на одного человека,
--     это особый случай, не покрывается дизайнерской матрицей.
--     Пресет продолжает работать на legacy-правилах.
--   - individual: density остаётся NULL по той же причине (одиночные
--     развороты, отдельная семантика).
--
-- sheet_type выводится из имени пресета:
--   - mini-soft → soft (имя говорит само)
--   - все остальные → hard (текущие пресеты в БД сделаны под layflat)
--
-- mini-hard в БД не существует — создаётся INSERT'ом как точная копия
-- mini-soft с заменой sheet_type='hard' и print_type='layflat'.
-- Сергей подтвердил: внутрянка одинаковая, отличается только тем что
-- мягкие начинаются справа/заканчиваются слева, плотные наоборот —
-- это data-нюанс, не структурный.
--
-- total_pages НЕ трогаем — остаётся DEFAULT 24 у всех. Реальные значения
-- партнёр будет настраивать через UI пресета (фаза РЭ.12). Сезонные
-- изменения чисел не будут требовать миграции БД.
--
-- Миграция идемпотентная: все UPDATE используют WHERE id=..., INSERT
-- защищён ON CONFLICT (id) DO NOTHING.

-- =============================================================
-- 1. UPDATE: проставить density + sheet_type существующим пресетам
-- =============================================================

UPDATE presets SET density = 'standard',  sheet_type = 'hard' WHERE id = 'standard';
UPDATE presets SET density = 'universal', sheet_type = 'hard' WHERE id = 'universal';
UPDATE presets SET density = 'medium',    sheet_type = 'hard' WHERE id = 'medium';
UPDATE presets SET density = 'light',     sheet_type = 'hard' WHERE id = 'light';
UPDATE presets SET density = 'mini',      sheet_type = 'soft' WHERE id = 'mini-soft';

-- Особые случаи: density остаётся NULL, sheet_type проставляется по типу листов
UPDATE presets SET sheet_type = 'hard' WHERE id = 'maximum';
UPDATE presets SET sheet_type = 'hard' WHERE id = 'individual';

-- =============================================================
-- 2. INSERT: mini-hard как точная копия mini-soft
-- =============================================================
-- Подзапрос берёт все поля mini-soft и меняет: id, display_name,
-- print_type, sheet_type. parent_preset_id оставляем NULL (это самостоятельный
-- глобальный пресет, не копия mini-soft в смысле наследования).

INSERT INTO presets (
  id, display_name, print_type, pages_per_spread, version, sections,
  tenant_id, parent_preset_id, enabled, total_pages, density, sheet_type
)
SELECT
  'mini-hard'                AS id,
  'Мини (плотные)'           AS display_name,
  'layflat'                  AS print_type,
  pages_per_spread,
  version,
  sections,
  tenant_id,
  NULL                       AS parent_preset_id,
  enabled,
  total_pages,
  'mini'                     AS density,
  'hard'                     AS sheet_type
FROM presets
WHERE id = 'mini-soft'
ON CONFLICT (id) DO NOTHING;

-- =============================================================
-- Проверочные запросы (выполнить после миграции):
-- =============================================================
-- SELECT id, display_name, print_type, total_pages, density, sheet_type
-- FROM presets ORDER BY id;
--
-- Ожидание (после применения):
--   id          | density   | sheet_type
--   ------------|-----------|----------
--   individual  | NULL      | hard
--   light       | light     | hard
--   maximum     | NULL      | hard
--   medium      | medium    | hard
--   mini-hard   | mini      | hard      ← новая запись
--   mini-soft   | mini      | soft
--   standard    | standard  | hard
--   universal   | universal | hard
--
-- Всего 8 пресетов. У 6 из них density задана, у Maximum/Individual
-- density=NULL (фолбэк на legacy-правила). У всех sheet_type задан.
--
-- Если у Maximum или Individual нужно другое sheet_type (например,
-- они тоже бывают мягкими) — Сергей правит UPDATE'ом вручную.
