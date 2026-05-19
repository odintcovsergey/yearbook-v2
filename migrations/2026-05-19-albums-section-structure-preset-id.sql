-- ============================================================
-- РЭ.21.8.7a — Колонка albums.section_structure_preset_id
-- ============================================================
-- Дата: 19.05.2026
--
-- Контекст:
--   После РЭ.21.8.3-6 готов третий build engine — buildFromSectionStructure,
--   читающий preset.section_structure (РЭ.21.2-7). Sandbox-проверка на
--   боевых данных (РЭ.21.8.6) и исправление имён мастеров (РЭ.21.8.6a)
--   показали что engine работает на 7 встроенных пресетах. Подключаем
--   к боевому handleBuildAlbum в миграционном режиме:
--
--     albums.section_structure_preset_id  rules_preset_id  → engine
--     ─────────────────────────────────── ──────────────── ──────────────────
--     NOT NULL                            *                buildFromSectionStructure
--     NULL                                NOT NULL          buildFromRules (legacy rule engine)
--     NULL                                NULL              buildAlbum (полностью legacy)
--
--   Приоритет section_structure > rules — потому что новый engine ближе
--   к продуктовой реальности (партнёрский редактор уже сейчас собирает
--   section_structure через РЭ.21.3-7 UI). При сбое нового engine
--   handleBuildAlbum делает fallthrough на rules → legacy
--   (тот же паттерн что уже работает с rules_preset_id).
--
--   Альбомы НЕ мигрируются автоматически. Партнёр явно включает
--   section_structure_preset через UI (РЭ.21.8.7c) или через прямой SQL.
--
-- Тип:
--   text NULL, FK на presets(id). Аналогично rules_preset_id —
--   presets.id это slug ('standard', 'universal', ...), не uuid.
--
-- ON DELETE SET NULL — безопасный откат при удалении пресета,
-- как у rules_preset_id.

alter table albums
  add column if not exists section_structure_preset_id text
    references presets(id) on delete set null;

create index if not exists idx_albums_section_structure_preset_id
  on albums(section_structure_preset_id)
  where section_structure_preset_id is not null;

comment on column albums.section_structure_preset_id is
  'Если NOT NULL, альбом собирается через buildFromSectionStructure '
  'с этим пресетом (читает preset.section_structure). Имеет приоритет '
  'над rules_preset_id. NULL = откат на rules_preset_id → legacy. См. РЭ.21.8.';

-- Проверка структуры
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'albums'
  and column_name in ('section_structure_preset_id', 'rules_preset_id', 'config_preset_id')
order by column_name;
