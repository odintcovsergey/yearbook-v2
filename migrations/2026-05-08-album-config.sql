-- Миграция 1.0 — config_type/print_type в albums.
-- Поля nullable: существующие альбомы получат NULL, новая фаза 1 spec
-- говорит что UI запросит выбор перед первой сборкой.
--
-- CHECK-constraint'ы повторяют валидацию из buildAlbum (lib/album-builder/types.ts).

ALTER TABLE albums
ADD COLUMN config_type text CHECK (
  config_type IS NULL OR config_type IN (
    'standard', 'universal', 'maximum', 'medium',
    'light', 'mini', 'individual'
  )
);

ALTER TABLE albums
ADD COLUMN print_type text CHECK (
  print_type IS NULL OR print_type IN ('layflat', 'soft')
);

-- Проверка
SELECT
  COUNT(*) AS total_albums,
  COUNT(config_type) AS with_config,
  COUNT(print_type) AS with_print
FROM albums;
