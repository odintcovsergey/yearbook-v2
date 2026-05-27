-- ═══════════════════════════════════════════════════════════════════════════
-- Миграция: добавление категории common_collage в photos.type
--
-- РЭ.59: новая категория фото для коллажных вариаций (3-8 фото на странице).
-- Отдельная от common_sixth (которая остаётся для J-Collage-4 и J-Collage-6).
--
-- Партнёр сможет уже сейчас загружать фото в эту категорию через UI.
-- Мастера для отображения (J-Collage-3, -5, -7, -8 с миксованными слотами)
-- будут добавлены позже отдельной задачей вместе с aspect-aware fitting в
-- билдере.
--
-- Идемпотентна — повторное применение безопасно.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Удаляем старый CHECK constraint и пересоздаём с новым значением
ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_type_check;

ALTER TABLE photos ADD CONSTRAINT photos_type_check
  CHECK (type IN (
    'portrait',
    'group',
    'teacher',
    'common_spread',
    'common_full',
    'common_half',
    'common_quarter',
    'common_sixth',
    'common_collage'    -- РЭ.59: новая категория для коллажных вариаций
  ));

-- 2. Проверка применения (опционально, для отладки)
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname = 'photos_type_check';
