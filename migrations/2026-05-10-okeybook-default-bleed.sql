-- Подэтап 3.1 — bleed_mm = 5 для okeybook-default template_set.
--
-- Контекст: до фазы 3 bleed был 0 (взят из IDML "Плотные Мастер Белый"
-- где Preferences/DocumentBleedTopOffset=0). Для типографии стандарт
-- 3-5 мм запаса под обрез.
--
-- В фазе 3 PDF-builder использует это значение для расчёта mediaBox:
--   mediaBox = page_size + bleed_mm × 2 (по 5 мм с каждой стороны)
--   trimBox  = page_size (226 × 288 мм)
--   bleedBox = mediaBox
--
-- См. docs/phase-3-spec.md §3.1 (нижний блок миграций) и §4.5.

UPDATE template_sets
SET bleed_mm = 5
WHERE slug = 'okeybook-default'
  AND bleed_mm < 5;  -- safety: повышаем только если меньше (default = 3)

-- Проверка
SELECT slug, name, bleed_mm,
       (page_width_mm) AS page_w,
       (page_height_mm) AS page_h
FROM template_sets
WHERE slug = 'okeybook-default';
-- Ожидание: bleed_mm = 5, page_w = 226, page_h = 288.
