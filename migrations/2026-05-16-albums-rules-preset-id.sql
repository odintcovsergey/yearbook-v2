-- ============================================================
-- РЭ.16.1 — Колонка albums.rules_preset_id для подключения rule engine
-- ============================================================
-- Дата: 16.05.2026
--
-- Контекст:
--   После РЭ.14 (превью на реальных альбомах) и РЭ.15 (фиксы singleton +
--   ложных warnings) rule engine собирает корректный layout для боевых
--   альбомов (тест 2026, Школа 89 mini-soft). Подключаем к боевому
--   handleBuildAlbum в миграционном режиме:
--     - albums.rules_preset_id IS NULL    → legacy buildAlbum
--                                            (большинство существующих)
--     - albums.rules_preset_id IS NOT NULL → новый buildFromRules
--                                            (опционально для тестирования)
--
--   Альбомы НЕ мигрируются автоматически. Партнёр/owner явно выбирает
--   rules_preset через UI в форме редактирования (РЭ.16.3).
--
-- Тип:
--   text NULL, FK на presets(id). presets.id — text slug ('standard',
--   'universal', 'maximum', 'individual', 'medium', 'light', 'mini-soft')
--   а не uuid, как config_preset_id.
--
-- ON DELETE SET NULL — если пресет удалят, альбом откатится на legacy,
-- а не сломается. Это безопаснее CASCADE для прода.

alter table albums
  add column if not exists rules_preset_id text references presets(id) on delete set null;

create index if not exists idx_albums_rules_preset_id
  on albums(rules_preset_id)
  where rules_preset_id is not null;

comment on column albums.rules_preset_id is
  'Если NOT NULL, альбом собирается через rule engine (buildFromRules) с этим пресетом. '
  'NULL = legacy buildAlbum по config_preset_id. См. РЭ.16.';

-- Проверка структуры
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'albums' and column_name = 'rules_preset_id';
