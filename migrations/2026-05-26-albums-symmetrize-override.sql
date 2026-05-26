-- РЭ.46 — symmetrize_students_tail_override: override симметризации на уровне альбома.
--
-- Контекст:
--   Симметризация хвоста (РЭ.37.5) — настройка которая раньше была на
--   уровне пресета (presets.symmetrize_students_tail). По обратной связи
--   Сергея — это часто-меняемая настройка, удобнее переключать на лету
--   для конкретного альбома (по аналогии с print_type_override,
--   student_distribution, include_non_purchasers — РЭ.41.a/b/c).
--
--   Симметризация имеет смысл только для density-режимов с
--   grid-сеткой (Light grid 6, Mini grid 12). Применяется когда в
--   хвосте остался ОДИН ученик — engine берёт ещё одного с предыдущей
--   страницы чтобы хвост стал парным.
--
-- Решение:
--   Новое поле albums.symmetrize_students_tail_override со значениями:
--     • NULL  — использовать значение из пресета (преобладает)
--     • true  — принудительно ВКЛЮЧИТЬ симметризацию
--     • false — принудительно ВЫКЛЮЧИТЬ симметризацию
--
--   Engine читает: preset.symmetrize_students_tail с возможным override
--   от album.symmetrize_students_tail_override (если не NULL).
--
-- DEFAULT NULL:
--   Существующие альбомы продолжают использовать настройку пресета.
--   Сергей сможет переопределить через inline-контрол на 'Обзоре'.

ALTER TABLE albums
  ADD COLUMN IF NOT EXISTS symmetrize_students_tail_override boolean DEFAULT NULL;

-- Проверка после миграции:
-- SELECT symmetrize_students_tail_override, COUNT(*) FROM albums GROUP BY 1;
