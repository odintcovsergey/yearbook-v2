// Генератор seed-SQL для master_page_types (Фаза 1, канон). Только формирует SQL-файл.
import fs from 'fs';

const out = process.argv[2];

// ── помощники сборки нумерованных слотов ──
const slot = (label, type, required) => ({ label, type, required });
const range = (pfx, n, type, required) =>
  Array.from({ length: n }, (_, i) => slot(`${pfx}_${i + 1}`, type, required));
// студенты: портрет+имя required=true (решение Сергея), цитата/друзья=false
const portraits = (n) => range('studentportrait', n, 'photo', true);
const names = (n) => range('studentname', n, 'text', true);
const quotes = (n) => range('studentquote', n, 'text', false);
const friendsOpt = (n) => range('studentphoto', n, 'photo', false); // друзья опциональны
const friendsContent = (n) => range('studentphoto', n, 'photo', true); // друзья = контент страницы
const collage = (n) => range('collagephoto', n, 'photo', false);
const classphoto = (req) => [slot('classphotoframe', 'photo', req)];
const tphotos = (n) => range('teacherphoto', n, 'photo', true);
const tnames = (n) => range('teachername', n, 'text', false);
const troles = (n) => range('teacherrole', n, 'text', false);
const head = () => [
  slot('headteacherphoto_1', 'photo', true),
  slot('headteachername_1', 'text', true),
  slot('headteacherrole_1', 'text', false),
  slot('headtextframe', 'text', false),
];

// ── 41 тип канона ──
const T = [];
const add = (code, display_name, family_id, page_role, slot_capacity, canonical_slots, page_type, notes = null) =>
  T.push({ code, display_name, family_id, page_role, slot_capacity, canonical_slots, page_type, notes });

// common-section (9)
add('common-collage-3', 'Коллаж из 3 фото', 'common-section', 'common', { photos_collage: 3 }, collage(3), null);
add('common-collage-4', 'Коллаж из 4 фото', 'common-section', 'common', { photos_collage: 4 }, collage(4), null);
add('common-collage-5', 'Коллаж из 5 фото', 'common-section', 'common', { photos_collage: 5 }, collage(5), null);
add('common-collage-6', 'Коллаж из 6 фото', 'common-section', 'common', { photos_collage: 6 }, collage(6), null);
add('common-full-page', 'Общее фото (страница)', 'common-section', 'common', { photos_full: 1 }, classphoto(true), null);
add('common-spread', 'Общее фото (разворот)', 'common-section', 'common', { photos_full: 1 }, [slot('spreadphoto', 'photo', true)], 'spread');
add('common-half', 'Два фото (½)', 'common-section', 'common', { photos_half: 2 }, range('halfphoto', 2, 'photo', false), null);
add('common-quarter', 'Два фото (¼)', 'common-section', 'common', { photos_quarter: 2 }, range('quarterphoto', 2, 'photo', false), null);
add('common-sixth', 'Шесть мелких фото', 'common-section', 'common', { photos_sixth: 6 }, range('sixthphoto', 6, 'photo', false), null);

// student-section — сетки (6)
add('grid-mini-12', 'Сетка на 12 (мини)', 'student-section', 'student_grid', { has_name: true, students: 12, has_quote: false, photos_full: 0, has_portrait: true }, [...portraits(12), ...names(12)], null);
add('grid-mini-4-combined', 'Сетка на 4 + общее фото (мини)', 'student-section', 'student_grid', { has_name: true, students: 4, has_quote: false, photos_full: 1, has_portrait: true }, [...portraits(4), ...names(4), ...classphoto(false)], null);
add('grid-light-6', 'Сетка на 6 (лайт)', 'student-section', 'student_grid', { has_name: true, students: 6, has_quote: false, photos_full: 0, has_portrait: true }, [...portraits(6), ...names(6)], null);
add('grid-light-3-combined', 'Сетка на 3 + общее фото (лайт)', 'student-section', 'student_grid', { has_name: true, students: 3, has_quote: false, photos_full: 1, has_portrait: true }, [...portraits(3), ...names(3), ...classphoto(false)], null);
add('grid-medium-4', 'Сетка на 4 с цитатами (медиум)', 'student-section', 'student_grid', { has_name: true, students: 4, has_quote: true, photos_full: 0, has_portrait: true }, [...portraits(4), ...names(4), ...quotes(4)], null);
add('grid-medium-2-combined', 'Сетка на 2 с цитатами + общее (медиум)', 'student-section', 'student_grid', { has_name: true, students: 2, has_quote: true, photos_full: 1, has_portrait: true }, [...portraits(2), ...names(2), ...quotes(2), ...classphoto(false)], null);

// common-section — combined-tail сетки (3) — family-аномалия
const TAIL_NOTE = 'family в данных = common-section, по роли student_grid — выправить при перезаливке дизайна';
add('grid-tail-2', 'Хвостовая сетка на 2 + общее', 'common-section', 'student_grid', { students: 2, photos_full: 1 }, [...portraits(2), ...names(2), ...classphoto(false)], 'left', TAIL_NOTE);
add('grid-tail-3', 'Хвостовая сетка на 3 + общее', 'common-section', 'student_grid', { students: 3, photos_full: 1 }, [...portraits(3), ...names(3), ...classphoto(false)], 'left', TAIL_NOTE);
add('grid-tail-4', 'Хвостовая сетка на 4 + общее', 'common-section', 'student_grid', { students: 4, photos_full: 1 }, [...portraits(4), ...names(4), ...classphoto(false)], 'left', TAIL_NOTE);

// student-section — личные left (3)
add('personal-standard-left', 'Личная (стандарт), лево', 'student-section', 'student_left', { has_name: true, students: 1, has_quote: true, has_portrait: true, photos_friend: 0 }, [...portraits(1), ...names(1), ...quotes(1)], 'left');
add('personal-universal-left', 'Личная (универсал, 2 друга), лево', 'student-section', 'student_left', { has_name: true, students: 1, has_quote: true, has_portrait: true, photos_friend: 2 }, [...portraits(1), ...names(1), ...quotes(1), ...friendsOpt(2)], 'left');
add('personal-max-left', 'Личная (макси, без цитаты), лево', 'student-section', 'student_left', { has_name: true, students: 1, has_quote: false, has_portrait: true, photos_friend: 0 }, [...portraits(1), ...names(1)], 'left');

// student-section — личные/коллаж right (8)
add('personal-standard-right', 'Личная (стандарт), право', 'student-section', 'student_right', { has_name: true, students: 1, has_quote: true, has_portrait: true, photos_friend: 0 }, [...portraits(1), ...names(1), ...quotes(1)], 'right');
add('personal-universal-right', 'Личная (универсал, 2 друга), право', 'student-section', 'student_right', { has_name: true, students: 1, has_quote: true, has_portrait: true, photos_friend: 2 }, [...portraits(1), ...names(1), ...quotes(1), ...friendsOpt(2)], 'right');
add('personal-max-right', 'Личная (макси, 4 друга+цитата), право', 'student-section', 'student_right', { has_name: false, students: 1, has_quote: true, has_portrait: false, photos_friend: 4 }, [...friendsContent(4), ...quotes(1)], 'right');
add('friends-collage-2', 'Друзья: коллаж из 2', 'student-section', 'student_right', { has_name: false, students: 0, has_quote: false, has_portrait: false, photos_friend: 2 }, friendsContent(2), null);
add('friends-collage-3', 'Друзья: коллаж из 3', 'student-section', 'student_right', { has_name: false, students: 0, has_quote: false, has_portrait: false, photos_friend: 3 }, friendsContent(3), null);
add('friends-collage-4', 'Друзья: коллаж из 4', 'student-section', 'student_right', { has_name: false, students: 0, has_quote: false, has_portrait: false, photos_friend: 4 }, friendsContent(4), null);
add('friends-collage-5', 'Друзья: коллаж из 5', 'student-section', 'student_right', { has_name: false, students: 0, has_quote: false, has_portrait: false, photos_friend: 5 }, friendsContent(5), null);
add('friends-collage-6', 'Друзья: коллаж из 6', 'student-section', 'student_right', { has_name: false, students: 0, has_quote: false, has_portrait: false, photos_friend: 6 }, friendsContent(6), null);

// head-teacher (4)
add('head-only', 'Классрук (только портрет)', 'head-teacher', 'teacher_left', { teachers: 0, head_teacher: 1 }, head(), null);
add('head-with-classphoto', 'Классрук + общее фото', 'head-teacher', 'teacher_left', { photos_full: 1, head_teacher: 1 }, [...head(), ...classphoto(false)], 'left');
add('head-with-4-teachers', 'Классрук + 4 учителя', 'head-teacher', 'teacher_left', { teachers: 4, head_teacher: 1 }, [...head(), ...tphotos(4), ...tnames(4), ...troles(4)], null);
add('head-with-8-teachers', 'Классрук + 8 учителей', 'head-teacher', 'teacher_left', { teachers: 8, head_teacher: 1 }, [...head(), ...tphotos(8), ...tnames(8), ...troles(8)], null);

// subject-teachers (4) + class-photo (2)
add('teachers-6', 'Учителя: 6', 'subject-teachers', 'teacher_right', { teachers: 6 }, [...tphotos(6), ...tnames(6), ...troles(6)], 'right');
add('teachers-9', 'Учителя: 9', 'subject-teachers', 'teacher_right', { teachers: 9 }, [...tphotos(9), ...tnames(9), ...troles(9)], 'right');
add('teachers-12', 'Учителя: 12', 'subject-teachers', 'teacher_right', { teachers: 12 }, [...tphotos(12), ...tnames(12), ...troles(12)], 'right');
add('teachers-16', 'Учителя: 16', 'subject-teachers', 'teacher_right', { teachers: 16 }, [...tphotos(16), ...tnames(16), ...troles(16)], 'right');
add('class-full', 'Групповое фото класса', 'class-photo', 'teacher_right', { photos_full: 1 }, classphoto(true), null);
add('class-half', 'Групповые фото (½)', 'class-photo', 'teacher_right', { photos_half: 2 }, range('halfphoto', 2, 'photo', true), null);

// intro / final (2)
add('title-page', 'Заглавный лист', 'intro', 'intro', { photos_full: 1 }, classphoto(false), 'right');
add('final-page', 'Финальный лист', 'final', 'final', { photos_full: 1 }, classphoto(false), 'left');

// ── рендер SQL ──
const q = (s) => (s === null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

let sql = `-- Наполнение канона master_page_types (Фаза 1, seed). СГЕНЕРИРОВАНО scripts/gen-seed.
-- Идемпотентно: ON CONFLICT (code) DO UPDATE. Повторный запуск не плодит дубли.
-- НЕ трогает: placeholders, rules, движок, дизайны. Только канон + backfill type_id.
-- Откат наполнения:  delete from master_page_types;  (предварительно обнулив ссылки:
--   update spread_templates set master_page_type_id = null where master_page_type_id is not null;)

insert into master_page_types
  (code, display_name, family_id, page_role, slot_capacity, canonical_slots, page_type, is_active, notes)
values
`;
sql += T.map((t) =>
  `  (${q(t.code)}, ${q(t.display_name)}, ${q(t.family_id)}, ${q(t.page_role)}, ${j(t.slot_capacity)}, ${j(t.canonical_slots)}, ${q(t.page_type)}, true, ${q(t.notes)})`
).join(',\n');
sql += `
on conflict (code) do update set
  display_name    = excluded.display_name,
  family_id       = excluded.family_id,
  page_role       = excluded.page_role,
  slot_capacity   = excluded.slot_capacity,
  canonical_slots = excluded.canonical_slots,
  page_type       = excluded.page_type,
  is_active       = excluded.is_active,
  notes           = excluded.notes;

-- Backfill: проставить мастерам akvarel/belly ссылку на тип по (page_role + slot_capacity).
-- Неоднозначность common photos_full:1 (страница J-Full vs разворот J-Spread) разводим
-- по page_type: 'spread' → common-spread, иначе → common-full-page.
update spread_templates st
set master_page_type_id = mpt.id
from master_page_types mpt
where st.template_set_id in (select id from template_sets where slug in ('akvarel','belly'))
  and st.page_role is not null and st.slot_capacity is not null
  and st.page_role = mpt.page_role
  and st.slot_capacity = mpt.slot_capacity
  and (
    mpt.code not in ('common-spread','common-full-page')
    or (mpt.code = 'common-spread'    and st.page_type = 'spread')
    or (mpt.code = 'common-full-page' and st.page_type is distinct from 'spread')
  );
`;

fs.writeFileSync(out, sql);
console.log('типов:', T.length, '→', out);
console.log('коды:', T.map((t) => t.code).join(', '));
