-- Подэтап 1.0 — флаг классного руководителя для учителей.
-- До этой миграции UI определял классного руководителя по позиции в списке
-- (idx === 0 после ORDER BY created_at). Нужно явное поле — Smart-fill будет
-- читать head_teacher из БД для генерации учительского разворота.

-- 1. Колонка флага
ALTER TABLE teachers
  ADD COLUMN is_head_teacher BOOLEAN NOT NULL DEFAULT false;

-- 2. Один head на альбом (partial unique index)
CREATE UNIQUE INDEX teachers_one_head_per_album
  ON teachers (album_id)
  WHERE is_head_teacher = true;

-- 3. Бэкфил: для каждого альбома где есть учителя — отметить первого
-- по created_at как head. Это совпадает с текущей UI-логикой
-- (TeachersTab показывает description у teachers[0]).
WITH first_per_album AS (
  SELECT DISTINCT ON (album_id) id
  FROM teachers
  ORDER BY album_id, created_at ASC
)
UPDATE teachers
SET is_head_teacher = true
WHERE id IN (SELECT id FROM first_per_album);

-- Проверка
SELECT
  album_id,
  COUNT(*) AS teachers_total,
  COUNT(*) FILTER (WHERE is_head_teacher) AS heads
FROM teachers
GROUP BY album_id
ORDER BY album_id
LIMIT 20;
-- Ожидание: heads = 1 для каждого альбома (или 0 если в альбоме 0 учителей).
