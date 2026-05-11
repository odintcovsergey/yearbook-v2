-- Фаза А.2.2.b1 — фикс: J-* мастера в default_for_configs.
--
-- Проблема: builder в А.2.2.b начал автоматически вставлять общий раздел
-- альбома (buildCommonSection), но все J-* мастера (page_role='common')
-- имеют default_for_configs='{}' с миграции 07.05.2026
-- (2026-05-07-default-for-configs.sql строки 58-60).
--
-- Это было намеренно: до фазы А.2 builder не генерировал общий раздел
-- автоматически — J-* были «только для ручного выбора в редакторе фаз
-- 2-4». findMaster() корректно фильтрует кандидатов по default_for_configs
-- (это правильная семантика «автовыбор vs ручной»), поэтому
-- builder не мог найти J-Half/J-ClassPhoto/J-Quarter/J-Collage даже
-- когда они применимы по applies_to_configs.
--
-- Симптом (отчёт Сергея 11.05.2026 после деплоя А.2.2.b):
--   [common_section_skipped] common_full_class: J-ClassPhoto не найден,
--     10 фото не размещены
--   [common_section_skipped] common_half: J-Half не найден,
--     8 фото не размещены
--   [common_section_skipped] common_quarter: J-Quarter не найден,
--     12 фото не размещены
--   [common_section_skipped] common_sixth: J-Collage не найден,
--     30 фото не размещены
--
-- Решение: установить default_for_configs = applies_to_configs для всех
-- J-* мастеров. По SQL-аудиту 11.05.2026 applies_to_configs у этих
-- мастеров содержит все 7 комплектаций builder'а (standard, universal,
-- maximum, medium, light, mini, individual). tryumo НЕ включается —
-- это отдельный продукт, его мастера не генерируются в фазе 0
-- (см. project_phase0_tryumo_separate_masters).
--
-- Идемпотентность: WHERE default_for_configs = '{}' защищает от
-- повторного применения. Если миграция уже применена, второй UPDATE
-- найдёт 0 строк.

UPDATE spread_templates
SET default_for_configs = ARRAY[
  'standard','universal','maximum','medium','light','mini','individual'
]
WHERE template_set_id = (
  SELECT id FROM template_sets
  WHERE slug = 'okeybook-default' AND tenant_id IS NULL
)
  AND name LIKE 'J-%'
  AND default_for_configs = '{}';

-- Проверка результата (раскомментируй после применения):
-- SELECT name, default_for_configs, applies_to_configs
-- FROM spread_templates
-- WHERE template_set_id = (
--   SELECT id FROM template_sets
--   WHERE slug = 'okeybook-default' AND tenant_id IS NULL
-- )
--   AND name LIKE 'J-%'
-- ORDER BY name;
--
-- Ожидание: 8 строк, у всех default_for_configs совпадает с applies_to_configs.
