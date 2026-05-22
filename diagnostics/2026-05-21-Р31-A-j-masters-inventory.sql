-- ─────────────────────────────────────────────────────────────────────────
-- РЭ.31.A — Инвентаризация J-* мастеров в okeybook-default template_set.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Цель: понять что есть в БД сейчас, чтобы спланировать семантический
-- findCommonMaster (этап Б). До конкретных запросов «у меня хвост на
-- 1 ученика, найди классфото» нужно знать какие slot_capacity заполнены
-- у имеющихся J-мастеров.
--
-- Этот SQL — только SELECT'ы, не меняет БД. Применять в Supabase SQL Editor
-- и приложить результат сюда — я пойму что есть и что нужно дозаказать
-- дизайнеру (если что-то отсутствует).
--
-- Шесть отчётов:
--   1. Все J-* мастера okeybook-default — slot_capacity, размер, имя
--   2. Покрытие по категориям common-фото (full / half / quarter / sixth / collage)
--   3. Зеркальные пары L/R (J-Quarter-Left vs J-Quarter-Right и т.п.)
--   4. Combined-tail мастера (students > 0 И photos_full > 0) — для хвоста
--   5. partner-клоны okeybook-default — список template_set'ов которые
--      теоретически унаследовали тех же J-* мастеров (важно для clone-yzux0b16
--      «Медиум (копия)» Сергея)
--   6. Сравнение J-мастеров между okeybook-default и clone-yzux0b16
-- ─────────────────────────────────────────────────────────────────────────

-- ─── 1. Все J-* мастера okeybook-default ──────────────────────────────────
SELECT
  st.name,
  st.page_role,
  st.is_spread,
  st.width_mm,
  st.height_mm,
  st.slot_capacity,
  st.applies_to_configs,
  CASE WHEN st.placeholders IS NULL THEN 0
       ELSE jsonb_array_length(st.placeholders) END AS placeholders_count
FROM spread_templates st
WHERE st.template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND st.name LIKE 'J-%'
ORDER BY st.name;

-- ─── 2. Покрытие по категориям common-фото ────────────────────────────────
-- Для каждой категории — какие мастера её обслуживают и с каким count.
SELECT
  'full' AS category,
  st.name,
  (st.slot_capacity->>'photos_full')::int AS slots,
  (st.slot_capacity->>'students')::int AS students_slot
FROM spread_templates st
WHERE st.template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND st.name LIKE 'J-%'
  AND (st.slot_capacity->>'photos_full')::int > 0
UNION ALL
SELECT
  'half',
  st.name,
  (st.slot_capacity->>'photos_half')::int,
  (st.slot_capacity->>'students')::int
FROM spread_templates st
WHERE st.template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND st.name LIKE 'J-%'
  AND (st.slot_capacity->>'photos_half')::int > 0
UNION ALL
SELECT
  'quarter',
  st.name,
  (st.slot_capacity->>'photos_quarter')::int,
  (st.slot_capacity->>'students')::int
FROM spread_templates st
WHERE st.template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND st.name LIKE 'J-%'
  AND (st.slot_capacity->>'photos_quarter')::int > 0
UNION ALL
SELECT
  'sixth',
  st.name,
  (st.slot_capacity->>'photos_sixth')::int,
  (st.slot_capacity->>'students')::int
FROM spread_templates st
WHERE st.template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND st.name LIKE 'J-%'
  AND (st.slot_capacity->>'photos_sixth')::int > 0
UNION ALL
SELECT
  'collage',
  st.name,
  (st.slot_capacity->>'photos_collage')::int,
  (st.slot_capacity->>'students')::int
FROM spread_templates st
WHERE st.template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND st.name LIKE 'J-%'
  AND (st.slot_capacity->>'photos_collage')::int > 0
ORDER BY category, slots DESC, name;

-- ─── 3. Зеркальные пары L/R ───────────────────────────────────────────────
SELECT
  REGEXP_REPLACE(st.name, '-(Left|Right)$', '') AS base_name,
  string_agg(st.name, ', ' ORDER BY st.name) AS variants,
  COUNT(*) AS variant_count
FROM spread_templates st
WHERE st.template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND st.name LIKE 'J-%'
  AND (st.name ~ '-(Left|Right)$' OR EXISTS (
    SELECT 1 FROM spread_templates st2
    WHERE st2.template_set_id = st.template_set_id
      AND st2.name = st.name || '-Left'
  ))
GROUP BY base_name
ORDER BY base_name;

-- ─── 4. Combined-tail мастера (students>0 И photos_full>0) ───────────────
-- Это то что engine выбрал для Фёдоровой Варвары — мастер students=2,
-- photos_full=1. Здесь смотрим какие комбинации вообще есть.
SELECT
  st.name,
  (st.slot_capacity->>'students')::int AS students,
  (st.slot_capacity->>'photos_full')::int AS photos_full,
  (st.slot_capacity->>'photos_friend')::int AS photos_friend,
  COALESCE((st.slot_capacity->>'has_quote')::boolean, false) AS has_quote,
  st.page_role
FROM spread_templates st
WHERE st.template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND (st.slot_capacity->>'students')::int > 0
  AND (st.slot_capacity->>'photos_full')::int > 0
ORDER BY students, photos_full, name;

-- ─── 5. Partner-клоны okeybook-default ────────────────────────────────────
SELECT
  ts.id,
  ts.slug,
  ts.display_name,
  ts.tenant_id,
  ts.parent_template_set_id,
  ts.created_at,
  (SELECT COUNT(*) FROM spread_templates st
    WHERE st.template_set_id = ts.id AND st.name LIKE 'J-%') AS j_masters_count
FROM template_sets ts
WHERE ts.parent_template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
   OR ts.id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
ORDER BY ts.tenant_id NULLS FIRST, ts.created_at;

-- ─── 6. Diff J-мастеров между okeybook-default и clone-yzux0b16 ──────────
-- Какие имена J-мастеров есть в default но НЕТ в клоне (и наоборот).
WITH
  d AS (
    SELECT name FROM spread_templates
    WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
      AND name LIKE 'J-%'
  ),
  c AS (
    SELECT name FROM spread_templates
    WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'clone-yzux0b16')
      AND name LIKE 'J-%'
  )
SELECT 'only_in_default' AS where_, name FROM d EXCEPT SELECT 'only_in_default', name FROM c
UNION ALL
SELECT 'only_in_clone', name FROM c EXCEPT SELECT 'only_in_clone', name FROM d
ORDER BY where_, name;

-- ─── Что я хочу увидеть в выводе ──────────────────────────────────────────
-- Отчёт 1: список из 5-10 J-мастеров с заполненным slot_capacity.
-- Отчёт 2: для каждой категории common (full/half/quarter/sixth/collage)
--          хотя бы один мастер. Если какой-то категории НЕТ — это пробел
--          template_set'а, дизайнерская задача.
-- Отчёт 3: зеркальные пары J-Quarter-Left ↔ J-Quarter-Right (минимум).
-- Отчёт 4: мастер students=2, photos_full=1 — тот что использовался для
--          хвоста Тест2 (template_id=82a362a8 в JSON). И похожие.
-- Отчёт 5: клон-yzux0b16 в списке partner-клонов, его tenant_id =
--          tenant'у Сергея.
-- Отчёт 6: пустой результат означает что клон унаследовал ВСЕ J-мастера
--          один в один (это ожидаемо после РЭ.28). Непустой — расхождения.
