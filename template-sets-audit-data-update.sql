-- ======================================================================
-- template-sets-audit-data-update.sql
-- ======================================================================
-- Подэтап 0.8.6.2 — Семантические теги для 39 мастеров template_set okeybook-default
-- Дата: 2026-05-06
-- Источник: совместный аудит Сергей + Claude (стратег) на сессии 06.05.2026
-- Зависимость: template-sets-audit-fields-migration.sql (применён в 0.8.6.1)
-- ======================================================================

-- Все UPDATE-запросы используют WHERE name = '...' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44'
-- (template_set okeybook-default).

-- ============================================================
-- ГРУППА E — Ученики (7 мастеров)
-- ============================================================

-- 1. E-Student-Standard (Стандарт, разворот на 2 учеников)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard']::text[],
  page_role = 'student',
  slot_capacity = '{"students": 2}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Двухстраничный мастер. Кандидат на разделение на E-Student-Standard-Left + E-Student-Standard-Right для гибкости при нечётном числе учеников. См. master-cleanup-tz.md.'
WHERE name = 'E-Student-Standard' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 2. E-Student-Default (legacy fallback)
UPDATE spread_templates SET
  applies_to_configs = ARRAY[]::text[],
  page_role = 'student',
  slot_capacity = '{"students": 2}'::jsonb,
  is_fallback = true,
  mirror_for_soft = false,
  audit_notes = 'Legacy fallback мастер. Используется когда специализированный не найден. Через 6 месяцев пересмотреть на удаление.'
WHERE name = 'E-Student-Default' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 3. E-Student-Left (Универсал, левая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['universal']::text[],
  page_role = 'student',
  slot_capacity = '{"students": 1, "photos_friend": 2}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false
WHERE name = 'E-Student-Left' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 4. E-Student-Right (Универсал, правая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['universal']::text[],
  page_role = 'student',
  slot_capacity = '{"students": 1, "photos_friend": 2}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false
WHERE name = 'E-Student-Right' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 5. E-Max-Left (Максимум + Индивидуальный)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['maximum', 'individual']::text[],
  page_role = 'student',
  slot_capacity = '{"students": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false
WHERE name = 'E-Max-Left' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 6. E-Max-Right (Максимум + Индивидуальный, 4 фото с друзьями)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['maximum', 'individual']::text[],
  page_role = 'student',
  slot_capacity = '{"students": 1, "photos_friend": 4}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Текущий вариант: 4 фото с друзьями + цитата. Возможны альтернативные мастера: 5 фото / 6 фото / без текста. Создаются по запросу партнёров.'
WHERE name = 'E-Max-Right' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 7. E-Ind-Right-3 (Индивидуальный + Максимум, альтернатива на 3 фото)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['maximum', 'individual']::text[],
  page_role = 'student',
  slot_capacity = '{"students": 1, "photos_friend": 3}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Альтернатива E-Max-Right для случая когда у ученика 3 фото вместо 4. Расширено на maximum для будущей гибкости.'
WHERE name = 'E-Ind-Right-3' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- ============================================================
-- ГРУППА D — Медиум (3 мастера)
-- ============================================================

-- 8. D-Medium-Left (сетка 2x2, левая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['medium']::text[],
  page_role = 'student_grid',
  slot_capacity = '{"students": 4}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false
WHERE name = 'D-Medium-Left' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 9. D-Medium-Right (сетка 2x2, правая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['medium']::text[],
  page_role = 'student_grid',
  slot_capacity = '{"students": 4}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false
WHERE name = 'D-Medium-Right' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 10. D-Medium-Last-WithPhoto (последняя страница с фото)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['medium']::text[],
  page_role = 'student_last',
  slot_capacity = '{"students": 2, "photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Только левая сторона разворота. Зеркальная версия D-Medium-Last-WithPhoto-Right планируется к созданию дизайнером (см. master-cleanup-tz.md).'
WHERE name = 'D-Medium-Last-WithPhoto' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- ============================================================
-- ГРУППА F — Учительские левые страницы (6 мастеров)
-- ============================================================

-- 11. F-Head-WithPhoto (классрук + общее фото)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'teacher_left',
  slot_capacity = '{"head_teacher": 1, "photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Универсальный мастер для классрука + общего фото класса. Используется при 0 предметников или при 9-16 предметниках (когда правая страница занята сеткой G-Teachers-*).'
WHERE name = 'F-Head-WithPhoto' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 12. F-Head-SmallGrid (классрук + до 4 предметников)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'teacher_left',
  slot_capacity = '{"head_teacher": 1, "teachers": 4}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Используется при 1-4 предметниках. Классрук + до 4 предметников в один ряд.'
WHERE name = 'F-Head-SmallGrid' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 13. F-Head-LargeGrid (классрук + до 8 предметников)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'teacher_left',
  slot_capacity = '{"head_teacher": 1, "teachers": 8}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Используется при 5-8 предметниках напрямую и при 17-24 предметниках в режиме overflow (первые 8 здесь, остальные на G-Teachers-4x4). Для 25+ предметников нужен дополнительный разворот — см. master-cleanup-tz.md.'
WHERE name = 'F-Head-LargeGrid' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 14. F-Head-WithPhoto-R (зеркальная для isMiniSoft)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['mini']::text[],
  page_role = 'teacher_left',
  slot_capacity = '{"head_teacher": 1, "photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = true,
  audit_notes = 'Зеркальная версия F-Head-WithPhoto для случая isMiniSoft (Мини + мягкие листы), когда первая страница альбома = правая. На будущее: если появятся новые комплектации без S-Intro, применимость может быть расширена.'
WHERE name = 'F-Head-WithPhoto-R' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 15. F-Head-SmallGrid-R (зеркальная)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['mini']::text[],
  page_role = 'teacher_left',
  slot_capacity = '{"head_teacher": 1, "teachers": 4}'::jsonb,
  is_fallback = false,
  mirror_for_soft = true,
  audit_notes = 'Зеркальная версия F-Head-SmallGrid для isMiniSoft.'
WHERE name = 'F-Head-SmallGrid-R' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 16. F-Head-LargeGrid-R (зеркальная)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['mini']::text[],
  page_role = 'teacher_left',
  slot_capacity = '{"head_teacher": 1, "teachers": 8}'::jsonb,
  is_fallback = false,
  mirror_for_soft = true,
  audit_notes = 'Зеркальная версия F-Head-LargeGrid для isMiniSoft.'
WHERE name = 'F-Head-LargeGrid-R' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- ============================================================
-- ГРУППА G — Учительские правые страницы (5 мастеров)
-- ============================================================

-- 17. G-FullClass (общее фото)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'teacher_right',
  slot_capacity = '{"photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Правая сторона учительского разворота при 0-8 предметниках. Содержит одно общее фото всего класса (classPhotoFrame). Используется когда нет 2+ фото в common/half/ но есть общее фото в common/class_full/.'
WHERE name = 'G-FullClass' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 18. G-HalfClass (2 фото половин)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'teacher_right',
  slot_capacity = '{"photos_half": 2}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Правая сторона учительского разворота при 0-8 предметниках. Содержит 2 фото половин класса. Расположение — сверху и снизу (альбом вертикальный 226x288). Метки в IDML: halfLeftPhoto (верх), halfRightPhoto (низ) — имена унаследованы от дизайна, семантика top/bottom. Приоритетный вариант когда есть 2+ фото в common/half/.'
WHERE name = 'G-HalfClass' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 19. G-Teachers-3x3 (9 предметников)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'teacher_right',
  slot_capacity = '{"teachers": 9}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Сетка предметников 3x3, 9 слотов. Используется при точно 9 предметниках.'
WHERE name = 'G-Teachers-3x3' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 20. G-Teachers-4x3 (10-12 предметников)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'teacher_right',
  slot_capacity = '{"teachers": 12}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Сетка предметников 4x3, 12 слотов. Используется при 10-12 предметниках. Лишние слоты скрываются (visible=false) если их меньше 12.'
WHERE name = 'G-Teachers-4x3' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 21. G-Teachers-4x4 (13-16 + overflow до 24)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'teacher_right',
  slot_capacity = '{"teachers": 16}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Сетка предметников 4x4, 16 слотов. Используется при 13-16 предметниках напрямую и при 17-24 предметниках в режиме overflow (overflow содержит остальных 9-16 предметников после первых 8 на F-Head-LargeGrid). Для 25+ предметников нужен дополнительный разворот — см. master-cleanup-tz.md.'
WHERE name = 'G-Teachers-4x4' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- ============================================================
-- ГРУППА J — Общий раздел (8 мастеров)
-- ============================================================

-- 22. J-Half (slot H)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'common',
  slot_capacity = '{"photos_half": 2}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Слот H в общем разделе. 2 фото половин класса (halfPhoto_1, halfPhoto_2). Используется в обязательном разделе и в flex-цепочках. Также используется как нечётная правая страница (flex_C).'
WHERE name = 'J-Half' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 23. J-Quarter (slot Q)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'common',
  slot_capacity = '{"photos_quarter": 2}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Слот Q в общем разделе. 2 фото четверти класса. Высокий приоритет в flex_B. Визуально похож на J-Half, отличается метками плейсхолдеров.'
WHERE name = 'J-Quarter' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 24. J-Collage (6 фото коллаж)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'common',
  slot_capacity = '{"photos_collage": 6}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Коллаж 6 фото (collagePhoto_1..6). Семантика категории "collage" гибкая — у Сергея это 1/6 класса, у других фотографов могут быть смешанные групповые фото. Используется в flex_A/flex_B/flex_C цепочках с разными приоритетами.'
WHERE name = 'J-Collage' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 25. J-ClassPhoto (общее фото, левая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'common',
  slot_capacity = '{"photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Слот FULL в общем разделе. Одно общее фото всего класса (classPhotoFrame). Левая страница разворота. Зеркальная версия J-ClassPhoto-Right для правой.'
WHERE name = 'J-ClassPhoto' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 26. J-ClassPhoto-Right (общее фото, правая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'common',
  slot_capacity = '{"photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Зеркальная версия J-ClassPhoto для правой страницы разворота. Используется в flex_C (нечётная правая) и при overflow. Это обычная зеркальная пара (не -R для soft-листов как F-*-R).'
WHERE name = 'J-ClassPhoto-Right' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 27. J-HalfSixth (Фаза 2 — отложено)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'common',
  slot_capacity = '{"photos_half": 2, "photos_collage": 6}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Двухстраничный комбинированный мастер: 2 фото половин класса + 6 фото коллажа. Введён в фазе 2 скрипта. В текущей логике общего раздела НЕ используется (загружается переменной но не вставляется в очередь). Решение по интеграции — отложено на 0.11. Кандидат на разделение на одностраничные мастера или интеграция в новые сценарии разворотов общего раздела.'
WHERE name = 'J-HalfSixth' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 28. J-SixthFull (Фаза 2 — отложено)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'common',
  slot_capacity = '{"photos_collage": 6, "photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Двухстраничный комбинированный мастер: 6 фото коллажа + 1 общее фото класса. Введён в фазе 2. В текущей логике НЕ используется. Решение по интеграции — отложено на 0.11.'
WHERE name = 'J-SixthFull' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 29. J-SixthSixth (Фаза 2 — отложено)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'common',
  slot_capacity = '{"photos_collage": 12}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Двухстраничный мастер: 12 фото коллажа (по 6 на каждой стороне). Введён в фазе 2. В текущей логике НЕ используется. Решение по интеграции — отложено на 0.11.'
WHERE name = 'J-SixthSixth' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- ============================================================
-- ГРУППА L — Лайт (5 мастеров) + расширенный applies_to_configs (виньетка-бонус во всех комплектациях)
-- ============================================================

-- 30. L-6-Left (сетка 6, левая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'student_grid',
  slot_capacity = '{"students": 6}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Сетка 6 учеников на странице (портрет + имя). Левая страница разворота. Основное использование — Лайт. Также может использоваться как виньетка-бонус в любых других комплектациях. Адаптивные сетки L-2/L-3/L-4 пока не созданы — fallback на L-6 со скрытием пустых слотов.'
WHERE name = 'L-6-Left' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 31. L-6-Right (сетка 6, правая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'student_grid',
  slot_capacity = '{"students": 6}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Зеркальная пара L-6-Left, правая страница разворота.'
WHERE name = 'L-6-Right' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 32. L-6-Last (применение неясно)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'student_last',
  slot_capacity = '{"students": 3, "photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Применение неясно. По описанию IDML: 3 ученика + общее фото (4 Rect, 7 labels). В скрипте build_album.jsx переменная не используется в логике. Сергей подтвердил что не помнит зачем этот мастер. Возможно legacy от ранней версии алгоритма или дубликат L-Overflow-Row. Кандидат на изучение/удаление.'
WHERE name = 'L-6-Last' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 33. L-Overflow-Row (overflow Лайт, левая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'student_overflow',
  slot_capacity = '{"students": 3, "photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Overflow-страница для Лайт при 25-27 учениках. Содержит до 3 учеников + общее фото класса. Левая сторона. Может использоваться как доп. страница в любых других комплектациях. ВАЖНО: при остатке 1 ученика возможна эстетическая проблема — потребует балансировки в фазе 1+ (см. master-cleanup-tz.md).'
WHERE name = 'L-Overflow-Row' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 34. L-Overflow-Row-Right (overflow Лайт, правая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'student_overflow',
  slot_capacity = '{"students": 3, "photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Зеркальная версия L-Overflow-Row для правой стороны разворота. Используется при 31-32 учениках. Те же эстетические замечания про балансировку (см. master-cleanup-tz.md).'
WHERE name = 'L-Overflow-Row-Right' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- ============================================================
-- ГРУППА N — Мини (3 мастера) + расширенный applies_to_configs
-- ============================================================

-- 35. N-12-Left (сетка 12, левая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'student_grid',
  slot_capacity = '{"students": 12}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Сетка 12 учеников на странице (портрет + имя). Левая страница разворота. Основное использование — Мини и Индивидуальный (сетка-миниатюры после личных разворотов). Также может использоваться как виньетка-бонус в любых других комплектациях. Адаптивные сетки N-4/N-6/N-9 пока не созданы — fallback на N-12 со скрытием пустых слотов.'
WHERE name = 'N-12-Left' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 36. N-12-Right (сетка 12, правая)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'student_grid',
  slot_capacity = '{"students": 12}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Зеркальная пара N-12-Left, правая страница разворота.'
WHERE name = 'N-12-Right' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 37. N-Overflow-Row (overflow Мини)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'student_overflow',
  slot_capacity = '{"students": 4, "photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Overflow-страница для Мини при 25-28 учениках. Содержит до 4 учеников + общее фото класса. Также используется в Индивидуальном при overflow. Может использоваться как доп. страница в любых других комплектациях. Эстетические замечания про балансировку — см. master-cleanup-tz.md.'
WHERE name = 'N-Overflow-Row' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- ============================================================
-- ГРУППА S — Intro (2 мастера)
-- ============================================================

-- 38. S-Intro (вступление для soft)
UPDATE spread_templates SET
  applies_to_configs = ARRAY['standard', 'universal', 'maximum', 'medium', 'light', 'mini', 'individual']::text[],
  page_role = 'intro',
  slot_capacity = '{"photos_full": 1}'::jsonb,
  is_fallback = false,
  mirror_for_soft = false,
  audit_notes = 'Вступительная страница для soft альбомов (мягкие листы). Используется только когда print_type = soft. Содержит одно общее фото класса (classPhotoFrame). Применима ко всем комплектациям кроме редкого случая Мини+мягкие — там вместо intro используется учительская страница (см. F-*-R мастера и поведение isMiniSoft в album-builder).'
WHERE name = 'S-Intro' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- 39. S-Intro-Old (legacy, кандидат на удаление)
UPDATE spread_templates SET
  applies_to_configs = ARRAY[]::text[],
  page_role = 'intro',
  slot_capacity = '{"photos_full": 1}'::jsonb,
  is_fallback = true,
  mirror_for_soft = false,
  audit_notes = 'LEGACY: тестовый двухстраничный intro мастер. Сергей подтвердил (06.05.2026) что использовался для тестов. Не используется в текущем скрипте build_album.jsx. КАНДИДАТ НА УДАЛЕНИЕ — отдельный коммит после аудита.'
WHERE name = 'S-Intro-Old' AND template_set_id = '08baf556-7831-44e9-9ba8-4af20f19ee44';

-- ============================================================
-- КОНЕЦ
-- ============================================================
-- Всего: 39 UPDATE запросов
-- Группы: E(7) + D(3) + F(6) + G(5) + J(8) + L(5) + N(3) + S(2) = 39
