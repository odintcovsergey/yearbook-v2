-- Seed: 7 глобальных пресетов в config_presets
--
-- Каждый пресет имеет 2 записи (layflat + soft), итого 14 строк.
-- Все tenant_id = NULL (глобальные).

INSERT INTO config_presets (tenant_id, slug, name, description, print_type, config) VALUES

-- ============================================================
-- STANDARD (Стандарт)
-- 1 разворот на 2 учеников, без фото с друзьями
-- ============================================================
(NULL, 'standard-layflat', 'Стандарт (твёрдые листы)',
 'Двое учеников на разворот. Портрет + ФИО + текст. Без фото с друзьями.',
 'layflat',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "single_page_per_student",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": {"enabled": true},
       "friend_photos": null
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": null,
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

(NULL, 'standard-soft', 'Стандарт (мягкие листы)',
 'То же что Стандарт, но мягкая обложка. Альбом начинается с правой страницы (S-Intro).',
 'soft',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "single_page_per_student",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": {"enabled": true},
       "friend_photos": null
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": {"type": "single_page"},
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

-- ============================================================
-- UNIVERSAL (Универсал)
-- = Стандарт + 2 фото с друзьями
-- ============================================================
(NULL, 'universal-layflat', 'Универсал (твёрдые листы)',
 'Двое учеников на разворот. Портрет + ФИО + текст + 2 фото с друзьями каждому.',
 'layflat',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "single_page_per_student",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": {"enabled": true},
       "friend_photos": {"enabled": true, "min": 0, "max": 2}
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": null,
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

(NULL, 'universal-soft', 'Универсал (мягкие листы)',
 'То же что Универсал, но мягкая обложка.',
 'soft',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "single_page_per_student",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": {"enabled": true},
       "friend_photos": {"enabled": true, "min": 0, "max": 2}
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": {"type": "single_page"},
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

-- ============================================================
-- MAXIMUM (Максимум)
-- 1 разворот на ученика (E-Max-Left + E-Max-Right), 4 фото с друзьями
-- ============================================================
(NULL, 'maximum-layflat', 'Максимум (твёрдые листы)',
 'Один ученик = разворот. Портрет + ФИО + текст слева, 4 фото с друзьями справа.',
 'layflat',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "spread_per_student",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": {"enabled": true},
       "friend_photos": {"enabled": true, "min": 0, "max": 4}
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": null,
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

(NULL, 'maximum-soft', 'Максимум (мягкие листы)',
 'То же что Максимум, но мягкая обложка.',
 'soft',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "spread_per_student",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": {"enabled": true},
       "friend_photos": {"enabled": true, "min": 0, "max": 4}
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": {"type": "single_page"},
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

-- ============================================================
-- MEDIUM (Медиум)
-- Сетка 4 ученика на странице (D-Medium-*)
-- ============================================================
(NULL, 'medium-layflat', 'Медиум (твёрдые листы)',
 'Сетка по 4 ученика на странице. Портрет + ФИО + текст.',
 'layflat',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "grid_multiple_students",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": {"enabled": true},
       "friend_photos": null
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": null,
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

(NULL, 'medium-soft', 'Медиум (мягкие листы)',
 'То же что Медиум, но мягкая обложка.',
 'soft',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "grid_multiple_students",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": {"enabled": true},
       "friend_photos": null
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": {"type": "single_page"},
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

-- ============================================================
-- LIGHT (Лайт)
-- Сетка 6 учеников на странице (L-6), без текста, без фото с друзьями
-- ============================================================
(NULL, 'light-layflat', 'Лайт (твёрдые листы)',
 'Сетка по 6 учеников на странице. Портрет + ФИО, без текста.',
 'layflat',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "grid_multiple_students",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": null,
       "friend_photos": null
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": null,
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

(NULL, 'light-soft', 'Лайт (мягкие листы)',
 'То же что Лайт, но мягкая обложка.',
 'soft',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "grid_multiple_students",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": null,
       "friend_photos": null
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": {"type": "single_page"},
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

-- ============================================================
-- MINI (Мини / Фотопапка)
-- Сетка 12 учеников на странице (N-12), без текста
-- В soft варианте: одностраничная учительская (F-*-R), без S-Intro
-- ============================================================
(NULL, 'mini-layflat', 'Мини (твёрдые листы)',
 'Сетка по 12 учеников на странице. Самая компактная комплектация.',
 'layflat',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "grid_multiple_students",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": null,
       "friend_photos": null
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": null,
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

(NULL, 'mini-soft', 'Мини (мягкие листы)',
 'То же что Мини, но мягкая обложка. Особый случай: одностраничная учительская, без вступительной страницы.',
 'soft',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "grid_multiple_students",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": null,
       "friend_photos": null
     },
     "additional_spreads": null,
     "thumbnails_section": null
   },
   "teacher_section": {
     "enabled": true,
     "layout": "one_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": null
   },
   "intro_section": null,
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

-- ============================================================
-- INDIVIDUAL (Индивидуальный)
-- 1 разворот на ученика + сетка миниатюр в конце (для садов)
-- ============================================================
(NULL, 'individual-layflat', 'Индивидуальный (твёрдые листы)',
 'Один ребёнок = разворот, 3 фото с друзьями. В конце сетка миниатюр всех детей. Для садов и младших классов.',
 'layflat',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "spread_per_student",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": {"enabled": true},
       "friend_photos": {"enabled": true, "min": 0, "max": 3}
     },
     "additional_spreads": null,
     "thumbnails_section": {"enabled": true, "preferred_grid_size": 12}
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": null,
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb),

(NULL, 'individual-soft', 'Индивидуальный (мягкие листы)',
 'То же что Индивидуальный, но мягкая обложка.',
 'soft',
 '{
   "student_section": {
     "spreads_per_student": {"min":1,"max":1,"default":1,"per_student":false},
     "base_layout_mode": "spread_per_student",
     "first_spread_content": {
       "portrait": true,
       "full_name": true,
       "text": {"enabled": true},
       "friend_photos": {"enabled": true, "min": 0, "max": 3}
     },
     "additional_spreads": null,
     "thumbnails_section": {"enabled": true, "preferred_grid_size": 12}
   },
   "teacher_section": {
     "enabled": true,
     "layout": "two_page",
     "show_head_teacher": true,
     "max_subjects_per_page": 8,
     "right_page_content": "auto_common_photo"
   },
   "intro_section": {"type": "single_page"},
   "cover_section": {"cover_type": "portrait_photo"}
 }'::jsonb);

-- Проверка: 14 записей (7 пресетов × 2 print_type)
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE print_type = 'layflat') AS layflat_count,
  COUNT(*) FILTER (WHERE print_type = 'soft') AS soft_count,
  COUNT(*) FILTER (WHERE tenant_id IS NULL) AS global_count
FROM config_presets;

-- Должно быть: total=14, layflat_count=7, soft_count=7, global_count=14

-- Просмотр всех пресетов
SELECT slug, name, print_type
FROM config_presets
ORDER BY
  CASE
    WHEN slug LIKE 'standard%' THEN 1
    WHEN slug LIKE 'universal%' THEN 2
    WHEN slug LIKE 'maximum%' THEN 3
    WHEN slug LIKE 'medium%' THEN 4
    WHEN slug LIKE 'light%' THEN 5
    WHEN slug LIKE 'mini%' THEN 6
    WHEN slug LIKE 'individual%' THEN 7
  END,
  print_type;
