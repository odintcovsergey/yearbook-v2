-- ТЗ 17.06.2026 — два РАВНЫХ главных (классруков / воспитателей) на альбом.
-- Школа и детсад могут иметь двух главных (детсадовский мастер «Аква меч»
-- рассчитан на двух воспитателей: headteacherphoto_1/_2). До этой миграции
-- partial unique index teachers_one_head_per_album разрешал ровно ОДНОГО
-- главного на альбом — это блокер.
--
-- Решение: снять unique index. Лимит «не более двух главных на альбом»
-- теперь enforced на уровне API (app/api/tenant/route.ts, action=update_teacher):
-- при попытке отметить третьего возвращается понятная ошибка. Postgres-индексом
-- ограничение «≤2» простым способом не выражается, поэтому полагаемся на API.

DROP INDEX IF EXISTS teachers_one_head_per_album;

-- Проверка: индекса больше нет, существующие данные не тронуты.
SELECT
  album_id,
  COUNT(*) AS teachers_total,
  COUNT(*) FILTER (WHERE is_head_teacher) AS heads
FROM teachers
GROUP BY album_id
ORDER BY heads DESC
LIMIT 20;
-- Ожидание: heads = 0 или 1 для всех (двух главных ещё никто не отмечал —
-- старый индекс не давал). После миграции UI разрешит отметить второго.
