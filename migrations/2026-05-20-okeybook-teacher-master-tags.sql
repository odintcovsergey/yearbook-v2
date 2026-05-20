-- РЭ.22.7.1: разметка teachers-мастеров для семантического поиска.
--
-- Контекст:
-- В РЭ.22.7.2 engine для секции 'teachers' будет переведён со slot-chains
-- (жёсткие имена F-Head-WithPhoto / F-Head-SmallGrid / F-Head-LargeGrid +
-- G-FullClass / G-HalfClass / G-Teachers-3x3 / G-Teachers-3x4 /
-- G-Teachers-4x4) на семантический поиск через page_role + slot_capacity.
--
-- Текущее состояние в БД (выгрузка 20.05.2026, все размеры из placeholders):
--   F-Head-LargeGrid         | NULL | {}                                    | head=1, teachers=8
--   F-Head-SmallGrid         | NULL | {}                                    | head=1, teachers=4
--   F-Head-WithClassPhoto-L  | NULL | {}                                    | head=1, classphoto=1
--   F-Head-WithPhoto         | NULL | {}                                    | head=1
--   G-FullClass              | NULL | {}                                    | classphoto=1
--   G-HalfClass              | NULL | {}                                    | halfphoto=2
--   G-Teachers-3x3           | NULL | {}                                    | teachers=9
--   G-Teachers-3x4           | NULL | {}                                    | teachers=12
--   G-Teachers-4x4           | NULL | {}                                    | teachers=16
--   T-TEST-Grid-9            | 'teacher_left' | {"teachers":9,...}          | (тест, размечен)
--
-- ⚠️ ПОПУТНО ОБНАРУЖЕН СКРЫТЫЙ БАГ (третий за фазу РЭ.22):
-- В коде teachers.ts:208 для subjects=10..12 ищется мастер 'G-Teachers-4x3'.
-- В БД мастер называется 'G-Teachers-3x4' (см. выгрузку выше). Legacy-код
-- для классов с 10-12 предметниками не находит правую страницу учительского
-- разворота → master_not_found → правая страница не строится.
--
-- Этот баг существует с момента создания фазы РЭ.21.8.4, никем не был
-- замечен — возможно тестовых классов с таким числом предметников просто
-- не попадалось. После РЭ.22.7.2 (engine семантический) баг автоматически
-- исчезнет — engine будет искать по slot_capacity.teachers=12, а не по
-- имени мастера.
--
-- Дополнительно: F-Head-WithClassPhoto-L — мастер которого код ВООБЩЕ
-- не знает (head=1 + classphoto=1, одна страница). После семантического
-- перехода engine сможет его использовать там где сейчас занимаются 2
-- страницы (F-Head-WithPhoto + G-FullClass для subjects=0 с общим фото).
-- Размечаем его сразу, чтобы РЭ.22.7.2 мог им пользоваться.
--
-- ⚠️ Миграция БЕЗУСЛОВНО overwrites page_role и slot_capacity для
-- перечисленных имён. Текущие значения дефолтные (NULL / {}). Для
-- T-TEST-Grid-9 в WHERE он НЕ включён — оставляем существующую разметку.

-- ─── 1. Левые страницы учительского разворота (F-Head-*) ───────────────────
-- page_role='teacher_left'. slot_capacity:
--   head_teacher = COUNT('headteacherphoto')
--   teachers     = COUNT('subjectphoto_N' / 'subject_N' / 'teacherphoto_N')
--   photos_full  = COUNT('classphotoframe') -- только у F-Head-WithClassPhoto-L

UPDATE spread_templates
SET
  page_role = 'teacher_left',
  slot_capacity = jsonb_build_object(
    'head_teacher', (
      SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') = 'headteacherphoto'
    ),
    'teachers', (
      SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') ~ '^(subjectphoto|subject|teacherphoto)_[0-9]+$'
    ),
    'photos_full', (
      SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') = 'classphotoframe'
    )
  )
WHERE name IN (
  'F-Head-LargeGrid',
  'F-Head-SmallGrid',
  'F-Head-WithClassPhoto-L',
  'F-Head-WithPhoto'
);

-- ─── 2. Правые страницы учительского разворота (G-*) ──────────────────────
-- page_role='teacher_right'. slot_capacity:
--   teachers      = COUNT('subjectphoto_N' / 'subject_N' / 'teacherphoto_N')
--   photos_full   = COUNT('classphotoframe')
--   photos_half   = COUNT('halfphoto_N')

UPDATE spread_templates
SET
  page_role = 'teacher_right',
  slot_capacity = jsonb_build_object(
    'teachers', (
      SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') ~ '^(subjectphoto|subject|teacherphoto)_[0-9]+$'
    ),
    'photos_full', (
      SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') = 'classphotoframe'
    ),
    'photos_half', (
      SELECT COUNT(*) FROM jsonb_array_elements(placeholders) e
      WHERE LOWER(e->>'label') ~ '^halfphoto_[0-9]+$'
    )
  )
WHERE name IN (
  'G-FullClass',
  'G-HalfClass',
  'G-Teachers-3x3',
  'G-Teachers-3x4',
  'G-Teachers-4x4'
);

-- ─── Проверка после применения ────────────────────────────────────────────
-- SELECT name, page_role, slot_capacity
-- FROM spread_templates
-- WHERE name LIKE 'F-Head%' OR name LIKE 'G-%'
-- ORDER BY name;
--
-- Ожидание:
--   F-Head-LargeGrid         | teacher_left  | {"head_teacher":1,"teachers":8,"photos_full":0}
--   F-Head-SmallGrid         | teacher_left  | {"head_teacher":1,"teachers":4,"photos_full":0}
--   F-Head-WithClassPhoto-L  | teacher_left  | {"head_teacher":1,"teachers":0,"photos_full":1}
--   F-Head-WithPhoto         | teacher_left  | {"head_teacher":1,"teachers":0,"photos_full":0}
--   G-FullClass              | teacher_right | {"teachers":0,"photos_full":1,"photos_half":0}
--   G-HalfClass              | teacher_right | {"teachers":0,"photos_full":0,"photos_half":2}
--   G-Teachers-3x3           | teacher_right | {"teachers":9,"photos_full":0,"photos_half":0}
--   G-Teachers-3x4           | teacher_right | {"teachers":12,"photos_full":0,"photos_half":0}
--   G-Teachers-4x4           | teacher_right | {"teachers":16,"photos_full":0,"photos_half":0}
