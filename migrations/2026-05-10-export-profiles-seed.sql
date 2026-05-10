-- Подэтап 3.1 — seed 3 глобальных профилей экспорта.
--
-- Контекст: после создания таблицы export_profiles нужны базовые
-- глобальные профили (tenant_id=NULL) которые видны всем партнёрам.
--
-- На старте 3 профиля:
--   1. okeybook-print          — типография, 300 dpi, с bleed, 30-80 МБ
--   2. okeybook-client-preview — для клиента, 150 dpi, без bleed, 5-10 МБ
--   3. okeybook-per-student    — STUB (фаза 3.A) — endpoint вернёт 501
--
-- Третий профиль создаётся для UI-видимости («фича на подходе») —
-- партнёр видит его в dropdown'е, но при выборе получает ошибку
-- 501 с текстом про фазу 3.A.
--
-- См. docs/phase-3-spec.md §3.1 и §4.4 (таблица параметров).

-- ON CONFLICT DO NOTHING для идемпотентности — миграция может
-- прогоняться повторно без ошибок (UNIQUE по (tenant_id, slug)).

INSERT INTO export_profiles (
  slug, name, is_default, purpose, format, quality,
  include_bleed, color_mode, dpi, jpeg_quality,
  filename_template, pages_mode, target_size_mb
) VALUES
  -- 1. Печать (типография) — основной профиль для отдачи в типографию.
  ('okeybook-print', 'Печать (типография)', true, 'typography', 'pdf', 'high',
   true, 'rgb', 300, 92,
   '{album_name}_{date}.pdf', 'all_common', 60),

  -- 2. Превью для клиента — для согласования макета. Без bleed,
  -- сжатие на selection WebP (быстро, маленький файл).
  ('okeybook-client-preview', 'Превью для клиента', false, 'preview', 'pdf', 'preview',
   false, 'rgb', 150, 80,
   '{album_name}_preview_{date}.pdf', 'all_common', 8),

  -- 3. Индивидуальные комплекты — STUB для фазы 3.A. Endpoint вернёт
  -- 501 Not Implemented с текстом «Per-student режим в разработке».
  ('okeybook-per-student', 'Индивидуальные комплекты (в разработке)', false, 'typography', 'pdf', 'high',
   true, 'rgb', 300, 92,
   '{student_name}_{album_name}.pdf', 'per_student', 10)

ON CONFLICT (COALESCE(tenant_id::text, 'global'), slug) DO NOTHING;

-- Проверка результата
SELECT slug, name, is_default, purpose, format, quality, include_bleed,
       dpi, pages_mode, target_size_mb, enabled
FROM export_profiles
WHERE tenant_id IS NULL
ORDER BY is_default DESC, slug;

-- Ожидание: 3 строки (или больше если миграция уже была применена).
-- okeybook-print должен быть is_default=true, остальные false.

-- Проверка что есть ровно один is_default=true среди глобальных
-- (если бы было несколько — UI был бы в неопределённом состоянии).
SELECT COUNT(*) AS default_count
FROM export_profiles
WHERE tenant_id IS NULL AND is_default = true;
-- Ожидание: 1
