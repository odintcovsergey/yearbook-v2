-- Фаза А.3.5 — N-12 мастера виньеток для всех комплектаций.
--
-- Контекст (тест Сергея 11.05.2026 после А.3.4):
--   В Универсале включил override vignettes_enabled=true и пересобрал
--   альбом. Builder упал с warning:
--     [master_not_found] adaptive_grid LEFT: no candidates for cfgType=universal
--
-- Причина: N-12-Left и N-12-Right (виньеточные мастера 12 учеников на
-- странице) имеют default_for_configs=['mini', 'individual']. findMaster
-- фильтрует по default_for_configs (правильная семантика 'автовыбор vs
-- ручной'), поэтому в Универсале/Стандарте/Максимуме их не находит.
--
-- Решение: расширить default_for_configs у N-12 на все 7 комплектаций.
-- N-12 — стандартный размер виньеток (4×3 миниатюр), технически работает
-- в любой комплектации. applies_to_configs у этих мастеров уже содержит
-- все 7 (значит UI редактора фаз 2-4 уже разрешает их использовать
-- вручную). Просто разрешаем builder'у выбирать их автоматически.
--
-- L-6 и D-Medium НЕ трогаем:
--   - L-6: виньетки 6 учеников на странице — это формат Лайт, не
--     виньеточный раздел в обычной комплектации.
--   - D-Medium: виньетки 12 учеников — но это формат Медиум, не
--     стандартный виньеточный раздел.
--   - Между N-12 и ними может быть коллизия выбора. Лучше один
--     детерминированный мастер N-12.
--
-- Миграция идемпотентная: даже если default_for_configs уже содержит
-- universal/standard/..., UPDATE безопасно перезаписывает.
--
-- Связано:
--   А.3.4 (UI dropdown override виньеток) — коммит 2654141
--   А.3.3 (backend override настройки) — коммит 72dc59d
--   А.3.2 (миграция БД vignettes_enabled) — коммит da8e70e
--   А.3.1 (фикс смещения учительского разворота) — коммит 1f27f27

UPDATE spread_templates
SET default_for_configs = ARRAY[
  'standard','universal','maximum','medium','light','mini','individual'
]
WHERE template_set_id = (
  SELECT id FROM template_sets
  WHERE slug = 'okeybook-default' AND tenant_id IS NULL
)
  AND name IN ('N-12-Left', 'N-12-Right');

-- Pre-check после применения:
-- SELECT name, page_role, default_for_configs
-- FROM spread_templates
-- WHERE template_set_id = (
--   SELECT id FROM template_sets WHERE slug = 'okeybook-default' AND tenant_id IS NULL
-- ) AND name IN ('N-12-Left', 'N-12-Right')
-- ORDER BY name;
--
-- Ожидание: 2 строки, у обеих default_for_configs содержит все 7
-- комплектаций.
