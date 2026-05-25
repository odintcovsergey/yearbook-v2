-- ============================================================
-- Привязка портретов к 5 новым ученикам эталонного альбома Тест2
--
-- Что делает:
--   1. photo_children — тэг «на этой фотке этот ребёнок»
--   2. selections — родитель выбрал портрет для личной страницы
--      (selection_type = 'portrait_page')
--   3. children.submitted_at = NOW() — статус «родитель подтвердил выбор»
--
-- Идемпотентность:
--   • photo_children: ON CONFLICT (photo_id, child_id) DO NOTHING
--   • selections: предварительно DELETE существующих portrait_page
--     для этих 5 детей (если уже была привязка — заменяем)
--   • children.submitted_at: UPDATE без условия (любое значение
--     перезаписывается на NOW; для теста это нормально)
--
-- Привязка:
--   DSC08430.jpg → Морозов Никита
--   DSC08432.jpg → Никитина Полина
--   DSC08436.jpg → Орлов Максим
--   DSC08439.jpg → Петрова Виктория
--   DSC08440.jpg → Соколов Кирилл
-- ============================================================

-- ─── ШАГ 1: photo_children (теги «кто на фото») ─────────────
INSERT INTO photo_children (photo_id, child_id)
SELECT p.id, c.id
FROM (VALUES
  ('DSC08430.jpg', 'Морозов Никита'),
  ('DSC08432.jpg', 'Никитина Полина'),
  ('DSC08436.jpg', 'Орлов Максим'),
  ('DSC08439.jpg', 'Петрова Виктория'),
  ('DSC08440.jpg', 'Соколов Кирилл')
) AS v(filename, full_name)
JOIN photos p ON p.filename = v.filename
  AND p.album_id = 'def23fce-5dfd-46d5-832e-efabe886b3ce'::uuid
JOIN children c ON c.full_name = v.full_name
  AND c.album_id = 'def23fce-5dfd-46d5-832e-efabe886b3ce'::uuid
ON CONFLICT (photo_id, child_id) DO NOTHING;

-- ─── ШАГ 2: удаляем старые portrait_page selections для этих 5
-- (если запускаем повторно — selections.insert не имеет ON CONFLICT,
-- может упасть на UNIQUE constraint child_id+selection_type+photo_id).
DELETE FROM selections
WHERE selection_type = 'portrait_page'
  AND child_id IN (
    SELECT id FROM children
    WHERE album_id = 'def23fce-5dfd-46d5-832e-efabe886b3ce'::uuid
      AND full_name IN (
        'Морозов Никита',
        'Никитина Полина',
        'Орлов Максим',
        'Петрова Виктория',
        'Соколов Кирилл'
      )
  );

-- ─── ШАГ 3: selections — родитель выбрал портрет ────────────
INSERT INTO selections (child_id, photo_id, selection_type)
SELECT c.id, p.id, 'portrait_page'
FROM (VALUES
  ('DSC08430.jpg', 'Морозов Никита'),
  ('DSC08432.jpg', 'Никитина Полина'),
  ('DSC08436.jpg', 'Орлов Максим'),
  ('DSC08439.jpg', 'Петрова Виктория'),
  ('DSC08440.jpg', 'Соколов Кирилл')
) AS v(filename, full_name)
JOIN photos p ON p.filename = v.filename
  AND p.album_id = 'def23fce-5dfd-46d5-832e-efabe886b3ce'::uuid
JOIN children c ON c.full_name = v.full_name
  AND c.album_id = 'def23fce-5dfd-46d5-832e-efabe886b3ce'::uuid;

-- ─── ШАГ 4: submitted_at + started_at (статус «Готово») ─────
UPDATE children
SET submitted_at = NOW(),
    started_at   = COALESCE(started_at, NOW())
WHERE album_id = 'def23fce-5dfd-46d5-832e-efabe886b3ce'::uuid
  AND full_name IN (
    'Морозов Никита',
    'Никитина Полина',
    'Орлов Максим',
    'Петрова Виктория',
    'Соколов Кирилл'
  );

-- ─── ПРОВЕРКА ───────────────────────────────────────────────
SELECT
  c.full_name,
  c.submitted_at IS NOT NULL AS is_submitted,
  (SELECT p.filename FROM selections s
   JOIN photos p ON p.id = s.photo_id
   WHERE s.child_id = c.id AND s.selection_type = 'portrait_page'
   LIMIT 1) AS portrait_chosen,
  (SELECT COUNT(*) FROM photo_children pch WHERE pch.child_id = c.id) AS tags_count
FROM children c
WHERE c.album_id = 'def23fce-5dfd-46d5-832e-efabe886b3ce'::uuid
  AND c.full_name IN (
    'Морозов Никита',
    'Никитина Полина',
    'Орлов Максим',
    'Петрова Виктория',
    'Соколов Кирилл'
  )
ORDER BY c.full_name;
