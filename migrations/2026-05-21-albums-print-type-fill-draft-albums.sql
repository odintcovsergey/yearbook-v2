-- РЭ.27.7b: дополнительная миграция — заполнение print_type для альбомов
-- без пресета (черновики).
--
-- Контекст:
-- После применения 2026-05-21-albums-print-type-data-and-preset-merge.sql
-- проверка показала что 6 альбомов остались с print_type=NULL:
--
--   93c10a9a-4831-4467-9e55-1e533038606d  Школа 11
--   9f5029d7-716d-4da4-950c-6cc454d17aa0  Школа 167
--   c857f67d-b7d0-4560-8aff-36f5219274b3  Школа 68
--   ffbd95da-78f9-4b52-9f90-dafe4701613a  Школа 18
--   1608ef0a-4742-4acb-ac6b-6f172e30629b  Школа Кузьминки
--   d15169e4-e101-4407-8fc5-d4518414ebad  Школа 17
--
-- У всех:
--   config_preset_id IS NULL
--   section_structure_preset_id IS NULL
--
-- То есть это альбомы-ЧЕРНОВИКИ без выбранного шаблона/пресета.
-- Они и не собирались бы корректно — engine требует пресет.
-- В основной миграции UPDATE через JOIN config_presets ничего не дал
-- (нет связанного пресета), поэтому print_type остался NULL.
--
-- Решение: проставить 'layflat' как дефолт для черновиков. Это:
--   - чистит NULL'ы в albums.print_type (теперь все 12 имеют значение)
--   - не влияет на сборку (без пресета она всё равно не запускается)
--   - даёт корректный default если пользователь позже выберет пресет
--     и захочет переопределить тип переплёта через UI селект РЭ.27.6.

BEGIN;

UPDATE albums
SET print_type = 'layflat'
WHERE print_type IS NULL
  AND config_preset_id IS NULL
  AND section_structure_preset_id IS NULL;

-- Контрольная проверка после применения:
-- SELECT print_type, COUNT(*) FROM albums GROUP BY print_type;
-- Ожидание: NULL = 0, layflat + soft = 12.

COMMIT;
