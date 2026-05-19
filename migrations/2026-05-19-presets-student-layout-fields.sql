-- РЭ.21.8.15: семантическое описание макета личного раздела в пресете.
--
-- Контекст:
-- Сейчас sections/students.ts выбирает мастера по жёстким именам:
--   density='standard'  → E-Standard-Left/Right
--   density='universal' → E-Universal-Left/Right
--   density=null + preset.id='maximum' → E-Max-Left/Right
-- Это не масштабируется на партнёров с своими комплектациями. Партнёр
-- может иметь любой набор мастеров личного раздела, и engine должен
-- находить подходящий по семантическим тегам, а не угадывать имя.
--
-- Решение Сергея 19.05.2026:
-- Партнёр при создании пресета описывает структуру личного раздела как
--   - сколько страниц у ученика (1 или 2)
--   - сколько фото с друзьями (0..10)
--   - есть ли слот для цитаты-текста
-- Engine ищет в template_set мастер с подходящим slot_capacity.
-- Если найден — используется. Если нет — fallback на ближайший меньший
-- по photos_friend + warning. Если совсем нет — warning master_not_found.
--
-- Новые колонки:
--   student_pages_per_student INT  — 1 (одна страница) | 2 (разворот)
--                                  | NULL (унаследовать поведение по density,
--                                          до миграции пресета)
--   student_friend_photos    INT  — 0..10, сколько фото с друзьями
--                                  | NULL = унаследовать
--   student_has_quote        BOOL — есть ли слот для текста-цитаты
--                                  | NULL = унаследовать
--
-- Все 3 колонки NULL по умолчанию для существующих 7 пресетов —
-- сохраняем обратную совместимость. Engine использует семантический
-- поиск только когда все 3 поля NOT NULL у пресета.

ALTER TABLE presets
  ADD COLUMN IF NOT EXISTS student_pages_per_student INT,
  ADD COLUMN IF NOT EXISTS student_friend_photos INT,
  ADD COLUMN IF NOT EXISTS student_has_quote BOOLEAN;

-- Whitelist значений для student_pages_per_student.
-- 1 = одна страница на ученика (одностраничные мастера типа E-Universal-Left).
-- 2 = разворот на ученика (двухстраничные пары типа E-Max-Left + E-Max-Right).
-- NULL = семантический поиск не активирован (fallback по preset.id / density).
ALTER TABLE presets
  ADD CONSTRAINT IF NOT EXISTS presets_student_pages_per_student_chk
    CHECK (student_pages_per_student IS NULL OR student_pages_per_student IN (1, 2));

-- Whitelist значений для student_friend_photos: разумный верхний предел 10.
ALTER TABLE presets
  ADD CONSTRAINT IF NOT EXISTS presets_student_friend_photos_chk
    CHECK (student_friend_photos IS NULL OR (student_friend_photos >= 0 AND student_friend_photos <= 10));
