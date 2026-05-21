-- ─────────────────────────────────────────────────────────────────────────
-- SEED: альбом «Тест2» — 25 учеников + 5 учителей + selections фото.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Цель: подготовить «боевой» тестовый альбом с заполненными данными,
-- чтобы можно было нажать «Собрать автоматически» и увидеть как engine
-- собирает разные комплектации (начинаем с Максимум).
--
-- Что делает скрипт:
--   1. Находит альбом по имени 'Тест2' (последний созданный)
--   2. Создаёт 25 учеников с разными ФИО, всех as заказчиков
--   3. Создаёт 5 учителей (1 head + 4 предметника)
--   4. Использует ФОТО УЖЕ ЗАГРУЖЕННЫЕ в этот альбом партнёром
--      (фото остаются в БД, мы только создаём selections и photo_children
--      связи).
--   5. Раздаёт каждому ученику:
--      • 1 фото portrait_page (выбор родителя)
--      • До 4 фото с друзьями (group selections)
--      • photo_children-связь с одной portrait фотографией
--   6. К учителям прикрепляет фото типа 'teacher' через photo_teachers.
--   7. Фото типа common_* НЕ трогает — engine сам найдёт их для общего раздела.
--
-- ПРЕДУСЛОВИЕ: партнёр уже загрузил в Тест2 фото с разными типами.
-- Минимум нужно: 1 portrait, 1 group, 1 teacher. Если фото мало —
-- они переиспользуются (один портрет может оказаться у нескольких
-- учеников). Это нормально для теста сборки.
--
-- После применения этого SQL:
--   • Открой Тест2 в UI
--   • Переключи шаблон на «Максимум» (или оставь Медиум для теста сетки)
--   • Нажми «Собрать автоматически»
--   • Должны появиться warnings — диагностируем их следующим шагом.
--
-- Идемпотентность: при повторном применении INSERT'ы пройдут заново
-- (создадут ЕЩЁ 25 детей и 5 учителей с теми же именами). Если нужен
-- чистый перезапуск — DELETE из children/teachers по album_id в начале.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_album_id        uuid;
  v_tenant_id       uuid;
  v_album_name      text := 'Тест2';

  -- ID-массивы для распределения
  v_photo_portraits uuid[];
  v_photo_groups    uuid[];
  v_photo_teachers  uuid[];
  v_new_child_ids   uuid[] := ARRAY[]::uuid[];
  v_new_teacher_ids uuid[] := ARRAY[]::uuid[];

  v_n_portraits     int;
  v_n_groups        int;
  v_n_teachers_ph   int;

  -- Имена учеников (25)
  v_student_names text[] := ARRAY[
    'Иванов Иван',         'Петрова Анна',         'Сидоров Михаил',
    'Кузнецова Мария',     'Смирнов Дмитрий',      'Попова Елизавета',
    'Васильев Артём',      'Морозова Полина',      'Соколов Никита',
    'Лебедева София',      'Козлов Александр',     'Новикова Виктория',
    'Морозов Илья',        'Волкова Дарья',        'Соловьёв Максим',
    'Воробьёва Алиса',     'Зайцев Тимофей',       'Павлова Ева',
    'Семёнов Кирилл',      'Голубева Анастасия',   'Виноградов Егор',
    'Богданова Милана',    'Воронов Лев',          'Фёдорова Варвара',
    'Михайлов Роман'
  ];

  -- Учителя (5: классный руководитель + 4 предметника)
  v_teacher_records record;
  v_teachers text[][] := ARRAY[
    ARRAY['Орлова Елена Сергеевна',      'Классный руководитель'],
    ARRAY['Беляева Татьяна Николаевна',  'Математика'],
    ARRAY['Никитин Олег Владимирович',   'Физика'],
    ARRAY['Жукова Ирина Анатольевна',    'Русский язык и литература'],
    ARRAY['Карпов Сергей Викторович',    'История']
  ];

  v_class      text := 'Тест 2';
  v_now        timestamptz := now();
  v_new_id     uuid;
  v_child_id   uuid;
  v_teacher_id uuid;
  v_portrait_id uuid;
  v_group_id   uuid;
  i            int;
  j            int;
  group_count  int;
BEGIN
  -- ─── 1. Найти альбом ───────────────────────────────────────────────────
  SELECT id, tenant_id INTO v_album_id, v_tenant_id
  FROM albums
  WHERE name = v_album_name
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_album_id IS NULL THEN
    RAISE EXCEPTION 'Альбом "%" не найден. Проверь точное имя.', v_album_name;
  END IF;

  RAISE NOTICE '✓ Альбом: id=%, tenant=%', v_album_id, v_tenant_id;

  -- ─── 2. Собрать существующие фото по типам ─────────────────────────────
  SELECT array_agg(id ORDER BY created_at) INTO v_photo_portraits
  FROM photos WHERE album_id = v_album_id AND type = 'portrait';

  SELECT array_agg(id ORDER BY created_at) INTO v_photo_groups
  FROM photos WHERE album_id = v_album_id AND type = 'group';

  SELECT array_agg(id ORDER BY created_at) INTO v_photo_teachers
  FROM photos WHERE album_id = v_album_id AND type = 'teacher';

  v_n_portraits   := COALESCE(array_length(v_photo_portraits, 1), 0);
  v_n_groups      := COALESCE(array_length(v_photo_groups, 1), 0);
  v_n_teachers_ph := COALESCE(array_length(v_photo_teachers, 1), 0);

  RAISE NOTICE '✓ Фото: portrait=%, group=%, teacher=%',
    v_n_portraits, v_n_groups, v_n_teachers_ph;

  IF v_n_portraits = 0 THEN
    RAISE EXCEPTION 'В альбоме нет фото типа portrait. Загрузи хотя бы одно.';
  END IF;
  IF v_n_teachers_ph = 0 THEN
    RAISE WARNING 'Нет фото учителей — учительский раздел будет без фото.';
  END IF;
  IF v_n_groups = 0 THEN
    RAISE WARNING 'Нет фото типа group — friend_photos будут пустыми.';
  END IF;

  -- ─── 3. Создать 25 учеников ────────────────────────────────────────────
  FOR i IN 1..array_length(v_student_names, 1) LOOP
    INSERT INTO children (album_id, full_name, class, is_purchased)
    VALUES (v_album_id, v_student_names[i], v_class, true)
    RETURNING id INTO v_new_id;

    v_new_child_ids := v_new_child_ids || v_new_id;
  END LOOP;

  RAISE NOTICE '✓ Создано % учеников', array_length(v_new_child_ids, 1);

  -- ─── 4. Создать 5 учителей ─────────────────────────────────────────────
  FOR i IN 1..array_length(v_teachers, 1) LOOP
    INSERT INTO teachers (album_id, full_name, position, is_head_teacher)
    VALUES (
      v_album_id,
      v_teachers[i][1],
      v_teachers[i][2],
      (i = 1)  -- первый = head
    )
    RETURNING id INTO v_new_id;

    v_new_teacher_ids := v_new_teacher_ids || v_new_id;
  END LOOP;

  RAISE NOTICE '✓ Создано % учителей (1 head)', array_length(v_new_teacher_ids, 1);

  -- ─── 5. Для каждого ученика: portrait_page selection + 4 group ────────
  FOR i IN 1..array_length(v_new_child_ids, 1) LOOP
    v_child_id := v_new_child_ids[i];

    -- 5.1 — portrait_page: round-robin по портретам
    v_portrait_id := v_photo_portraits[1 + ((i - 1) % v_n_portraits)];
    INSERT INTO selections (child_id, photo_id, selection_type)
    VALUES (v_child_id, v_portrait_id, 'portrait_page');

    -- photo_children: ребёнок присутствует на своём портрете
    INSERT INTO photo_children (photo_id, child_id)
    VALUES (v_portrait_id, v_child_id);

    -- 5.2 — 4 group selections (если хватает группового фото)
    IF v_n_groups > 0 THEN
      group_count := LEAST(4, v_n_groups);
      FOR j IN 1..group_count LOOP
        v_group_id := v_photo_groups[1 + (((i - 1) * 4 + j - 1) % v_n_groups)];
        INSERT INTO selections (child_id, photo_id, selection_type)
        VALUES (v_child_id, v_group_id, 'group');

        -- photo_children: ребёнок «присутствует» на этом групповом фото
        -- (нужно, чтобы engine считал photo как friend-фото для этого ребёнка)
        INSERT INTO photo_children (photo_id, child_id)
        VALUES (v_group_id, v_child_id)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;

    -- 5.3 — отметить ребёнка как подтвердившего выбор
    UPDATE children
    SET submitted_at = v_now,
        started_at  = v_now - interval '1 hour'
    WHERE id = v_child_id;
  END LOOP;

  RAISE NOTICE '✓ Selections созданы (portrait_page + group)';

  -- ─── 6. Привязать фото учителей к teachers ─────────────────────────────
  IF v_n_teachers_ph > 0 THEN
    FOR i IN 1..array_length(v_new_teacher_ids, 1) LOOP
      v_teacher_id := v_new_teacher_ids[i];
      INSERT INTO photo_teachers (photo_id, teacher_id)
      VALUES (
        v_photo_teachers[1 + ((i - 1) % v_n_teachers_ph)],
        v_teacher_id
      );
    END LOOP;
    RAISE NOTICE '✓ Фото учителей привязаны';
  END IF;

  -- ─── 7. Финальная проверка ────────────────────────────────────────────
  RAISE NOTICE '──────────────────────────────────────────────────';
  RAISE NOTICE 'Готово. Что собрано в альбоме "%":', v_album_name;
  RAISE NOTICE '  • % учеников (все is_purchased=true, submitted)',
    array_length(v_new_child_ids, 1);
  RAISE NOTICE '  • % учителей (1 head)',
    array_length(v_new_teacher_ids, 1);
  RAISE NOTICE '  • Selections portrait_page + group использовали';
  RAISE NOTICE '    % портретов, % групповых, % учительских',
    v_n_portraits, v_n_groups, v_n_teachers_ph;
  RAISE NOTICE '';
  RAISE NOTICE 'Дальше в UI:';
  RAISE NOTICE '  1. Переключи шаблон альбома на "Максимум" (виджет Шаблон)';
  RAISE NOTICE '  2. Нажми "Собрать автоматически"';
  RAISE NOTICE '  3. Смотри warnings в обзоре';
END $$;

-- ─── Опционально: явно переключить альбом на шаблон «Максимум» ─────────────
-- Раскомментируй, если хочешь сразу зафиксировать шаблон через SQL
-- (вместо ручного переключения в UI):
--
-- UPDATE albums
-- SET section_structure_preset_id = 'maximum'
-- WHERE name = 'Тест2'
--   AND id = (SELECT id FROM albums WHERE name = 'Тест2' ORDER BY created_at DESC LIMIT 1);
--
-- Проверка:
-- SELECT id, name, section_structure_preset_id
-- FROM albums WHERE name = 'Тест2';

-- ─── Чистка (если нужен полный rerun) ────────────────────────────────────
-- Эти DELETE'ы убирают всё что seed создал. Раскомментируй ВСЁ если
-- хочешь начать заново. Photos НЕ удаляются (они твои, загружены через UI).
--
-- WITH album AS (
--   SELECT id FROM albums WHERE name = 'Тест2' ORDER BY created_at DESC LIMIT 1
-- )
-- DELETE FROM selections WHERE child_id IN (
--   SELECT id FROM children WHERE album_id IN (SELECT id FROM album)
-- );
--
-- DELETE FROM photo_children WHERE child_id IN (
--   SELECT id FROM children WHERE album_id IN (
--     SELECT id FROM albums WHERE name = 'Тест2'
--   )
-- );
--
-- DELETE FROM photo_teachers WHERE teacher_id IN (
--   SELECT id FROM teachers WHERE album_id IN (
--     SELECT id FROM albums WHERE name = 'Тест2'
--   )
-- );
--
-- DELETE FROM teachers WHERE album_id IN (
--   SELECT id FROM albums WHERE name = 'Тест2'
-- );
--
-- DELETE FROM children WHERE album_id IN (
--   SELECT id FROM albums WHERE name = 'Тест2'
-- );
