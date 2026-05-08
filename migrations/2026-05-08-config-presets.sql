-- Миграция 0.5.1 — фундамент для гибких пресетов
--
-- Создаём таблицу config_presets (пустая, наполнится в 0.5.2 seed).
-- Удаляем временное поле albums.config_type (было добавлено в 1.0).
-- Добавляем FK в albums и children.

-- 1. Таблица config_presets
CREATE TABLE config_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
    -- NULL = глобальный пресет (доступен всем тенантам)

  slug text NOT NULL,
  name text NOT NULL,
  description text,

  print_type text NOT NULL CHECK (print_type IN ('layflat', 'soft')),

  config jsonb NOT NULL,
    -- Богатая структура (см. phase-0.5-spec.md)

  is_template boolean DEFAULT false,

  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT unique_tenant_slug_preset UNIQUE NULLS NOT DISTINCT (tenant_id, slug)
);

CREATE INDEX idx_config_presets_tenant ON config_presets(tenant_id);

COMMENT ON TABLE config_presets IS 'Пресеты комплектаций альбомов. Заполняется в 0.5.2 (7 глобальных).';
COMMENT ON COLUMN config_presets.config IS 'Богатая структура параметров (JSONB). См. docs/phase-0.5-spec.md часть "Полная структура config".';
COMMENT ON COLUMN config_presets.tenant_id IS 'NULL = глобальный пресет, видимый всем тенантам. UUID = персональный пресет тенанта.';

-- 2. Изменения в albums
-- Удаляем временное поле config_type (было добавлено в подэтапе 1.0)
ALTER TABLE albums DROP COLUMN IF EXISTS config_type;

-- Добавляем новые FK
ALTER TABLE albums
ADD COLUMN config_preset_id uuid REFERENCES config_presets(id),
ADD COLUMN template_set_id uuid REFERENCES template_sets(id);

COMMENT ON COLUMN albums.config_preset_id IS 'Базовая комплектация альбома (FK на config_presets). NULL = не задана.';
COMMENT ON COLUMN albums.template_set_id IS 'Дизайн (набор мастеров) альбома (FK на template_sets). NULL = по умолчанию.';

-- print_type оставляем (был добавлен в 1.0)

-- 3. Изменения в children
ALTER TABLE children
ADD COLUMN config_preset_id uuid REFERENCES config_presets(id);

COMMENT ON COLUMN children.config_preset_id IS 'Персональная комплектация ученика (FK). NULL = используется albums.config_preset_id (альбомная).';

-- 4. Backfill — никакой. Все существующие альбомы и дети получают NULL.
-- В фазе 1.3 UI запросит выбор пресета перед первой автосборкой.

-- 5. Проверка
SELECT
  (SELECT COUNT(*) FROM config_presets) AS presets_count,
  (SELECT COUNT(*) FROM albums) AS albums_count,
  (SELECT COUNT(*) FROM albums WHERE config_preset_id IS NULL) AS albums_without_preset,
  (SELECT COUNT(*) FROM children) AS children_count,
  (SELECT COUNT(*) FROM children WHERE config_preset_id IS NULL) AS children_without_preset;

-- Ожидаемый результат:
--   presets_count = 0 (пустая таблица — заполнится в 0.5.2)
--   albums_count = 9 (текущее состояние)
--   albums_without_preset = 9 (все NULL после миграции)
--   children_count = 157
--   children_without_preset = 157
