/**
 * Smoke-тест album-builder.
 *
 * Назначение: быстрая ручная проверка что buildAlbum() работает на реальной
 * БД для текущей комплектации шаблонов. Загружает template_set okeybook-default
 * из Supabase, прогоняет несколько сценариев, печатает результат.
 *
 * НЕ заменяет Vitest unit tests (которые появятся в 0.12) — это просто
 * быстрый способ убедиться что после очередной правки sceни/build.ts/
 * find-master.ts ничего не сломалось.
 *
 * Запуск:
 *   set -a && . ./.env.local && set +a && npx tsx scripts/smoke-album-builder.ts
 *
 * Опционально — выбрать одну комплектацию:
 *   ... npx tsx scripts/smoke-album-builder.ts standard
 *   ... npx tsx scripts/smoke-album-builder.ts universal,maximum
 */

import { createClient } from '@supabase/supabase-js';
import { buildAlbum, loadTemplateSet, loadPresetBySlug } from '../lib/album-builder';
import type {
  AlbumInput,
  Preset,
  TemplateSet,
  ConfigType,
  PrintType,
  Student,
  Subject,
  HeadTeacher,
  CommonPhotos,
} from '../lib/album-builder';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const presetCache = new Map<string, Preset>();

async function getPreset(slug: string): Promise<Preset> {
  let p = presetCache.get(slug);
  if (!p) {
    p = await loadPresetBySlug(supabase, slug);
    presetCache.set(slug, p);
  }
  return p;
}

// ─── Тестовые данные ────────────────────────────────────────────────────────

function makeStudent(name: string, friendCount: number): Student {
  return {
    full_name: name,
    quote: `Цитата ${name}`,
    portrait: `https://fake/${name}-portrait.jpg`,
    friend_photos: Array.from({ length: friendCount }, (_, i) => `https://fake/${name}-f${i}.jpg`),
  };
}

function makeSubject(name: string, role: string): Subject {
  return { name, role, photo: `https://fake/teacher-${name}.jpg` };
}

const HEAD_TEACHER: HeadTeacher = {
  name: 'Иванова Мария Петровна',
  role: 'классный руководитель',
  text: 'Дорогие выпускники, желаю вам успехов в дальнейшей жизни.',
  photo: 'https://fake/head.jpg',
};

const STUDENTS_5 = ['Алексеев', 'Бочкарёв', 'Васильев', 'Громов', 'Дмитриев']
  .map((n) => makeStudent(n, 4));

// Несколько различных размеров классов — для покрытия:
//   - чётные/нечётные
//   - стандартные размеры (24-30)
//   - для будущих 0.10b.3 (Медиум) и 0.11 (Лайт/Мини) — большие
const STUDENT_SETS: Record<string, Student[]> = {
  '1': [makeStudent('Андреев', 0)],
  '2': [makeStudent('Алексеев', 4), makeStudent('Бочкарёв', 4)],
  '4': Array.from({ length: 4 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '5': STUDENTS_5,
  '5_med': Array.from({ length: 5 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '6': [...STUDENTS_5, makeStudent('Егоров', 4)],
  '7': Array.from({ length: 7 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '8': Array.from({ length: 8 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '11': Array.from({ length: 11 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '12': Array.from({ length: 12 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '13': Array.from({ length: 13 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '16': Array.from({ length: 16 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '18': Array.from({ length: 18 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '24': Array.from({ length: 24 }, (_, i) => makeStudent(`Ученик${i + 1}`, 2)),
  '26': Array.from({ length: 26 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '27': Array.from({ length: 27 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '28': Array.from({ length: 28 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '29': Array.from({ length: 29 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '30': Array.from({ length: 30 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '32': Array.from({ length: 32 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '36': Array.from({ length: 36 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '3': Array.from({ length: 3 }, (_, i) => makeStudent(`Ученик${i + 1}`, 0)),
  '5_with_friends': Array.from({ length: 5 }, (_, i) => {
    const s = makeStudent(`Ученик${i + 1}`, 0);
    s.friend_photos = ['url-friend-1', 'url-friend-2', 'url-friend-3', 'url-friend-4'];
    return s;
  }),
  '5_mixed_friends': Array.from({ length: 5 }, (_, i) => {
    const s = makeStudent(`Ученик${i + 1}`, 0);
    if (i >= 3) {
      s.friend_photos = ['url-friend-1', 'url-friend-2', 'url-friend-3', 'url-friend-4'];
    }
    return s;
  }),
};

function makeSubjects(count: number): Subject[] {
  return Array.from({ length: count }, (_, i) => makeSubject(`Петров${i + 1}`, `учитель ${i + 1}`));
}

// ─── Сцены ──────────────────────────────────────────────────────────────────
// Сцена = один прогон buildAlbum + ожидаемые проверки

type Scene = {
  label: string;
  configType: ConfigType;
  studentsKey: keyof typeof STUDENT_SETS;
  subjectsCount: number;
  withHeadTeacher: boolean;
  // Минимальные ожидания: что проверяем после buildAlbum
  expect: {
    spreadsCount?: number;            // ровно столько SpreadInstance
    spreadsCountAtLeast?: number;     // не меньше столько
    warningCodes?: string[];          // эти коды должны быть среди warnings
    noWarningCodes?: string[];        // этих кодов НЕ должно быть среди warnings
    masterNameSequence?: string[];    // ожидаемая последовательность template_name
  };
  /** Override common_photos. Не указанные ключи дефолтятся к []. */
  commonPhotos?: Partial<CommonPhotos>;
  /** Override print_type. По умолчанию 'layflat'. */
  printType?: PrintType;
};

const SCENES: Scene[] = [
  // ─── Сценарии 0.10a (Стандарт/Универсал/Максимум) ───
  {
    label: 'standard / 5 students',
    configType: 'standard',
    studentsKey: '5',
    subjectsCount: 0,
    withHeadTeacher: false,
    expect: {
      spreadsCount: 3,
      warningCodes: ['students_odd_in_standard'],
      noWarningCodes: ['master_not_found', 'name_mismatch'],
    },
  },
  {
    label: 'standard / 6 students (чётное)',
    configType: 'standard',
    studentsKey: '6',
    subjectsCount: 0,
    withHeadTeacher: false,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['students_odd_in_standard', 'master_not_found', 'name_mismatch'],
    },
  },
  {
    label: 'universal / 5 students',
    configType: 'universal',
    studentsKey: '5',
    subjectsCount: 0,
    withHeadTeacher: false,
    expect: {
      spreadsCount: 5,
      noWarningCodes: ['master_not_found', 'name_mismatch'],
      masterNameSequence: [
        'E-Student-Left', 'E-Student-Right', 'E-Student-Left', 'E-Student-Right', 'E-Student-Left',
      ],
    },
  },
  {
    label: 'maximum / 5 students',
    configType: 'maximum',
    studentsKey: '5',
    subjectsCount: 0,
    withHeadTeacher: false,
    expect: {
      spreadsCount: 10,
      noWarningCodes: ['master_not_found', 'name_mismatch'],
      masterNameSequence: [
        'E-Max-Left', 'E-Max-Right',
        'E-Max-Left', 'E-Max-Right',
        'E-Max-Left', 'E-Max-Right',
        'E-Max-Left', 'E-Max-Right',
        'E-Max-Left', 'E-Max-Right',
      ],
    },
  },
  {
    label: 'standard / empty students',
    configType: 'standard',
    studentsKey: '5', // не используется (override на []) — см. main()
    subjectsCount: 0,
    withHeadTeacher: false,
    expect: {
      spreadsCount: 0,
      warningCodes: ['students_empty'],
    },
  },
  // ─── Учительский раздел (0.10b.2) ───
  {
    label: 'teachers / 0 subjects + half photos',
    configType: 'standard', studentsKey: '2',
    subjectsCount: 0, withHeadTeacher: true,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found', 'no_right_teacher_master'],
      masterNameSequence: ['F-Head-WithPhoto', 'G-HalfClass', 'E-Student-Standard'],
    },
    commonPhotos: { half: ['url-half-1', 'url-half-2'] },
  },
  {
    label: 'teachers / 0 subjects + only full_class',
    configType: 'standard', studentsKey: '2',
    subjectsCount: 0, withHeadTeacher: true,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found', 'no_right_teacher_master'],
      masterNameSequence: ['F-Head-WithPhoto', 'G-FullClass', 'E-Student-Standard'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  {
    label: 'teachers / 0 subjects + no common photos',
    configType: 'standard', studentsKey: '2',
    subjectsCount: 0, withHeadTeacher: true,
    expect: {
      spreadsCount: 2,
      warningCodes: ['no_right_teacher_master', 'class_photo_missing'],
      masterNameSequence: ['F-Head-WithPhoto', 'E-Student-Standard'],
    },
  },
  {
    label: 'teachers / 4 subjects + full_class',
    configType: 'standard', studentsKey: '2',
    subjectsCount: 4, withHeadTeacher: true,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found'],
      masterNameSequence: ['F-Head-SmallGrid', 'G-FullClass', 'E-Student-Standard'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  {
    label: 'teachers / 9 subjects',
    configType: 'standard', studentsKey: '2',
    subjectsCount: 9, withHeadTeacher: true,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found'],
      masterNameSequence: ['F-Head-WithPhoto', 'G-Teachers-3x3', 'E-Student-Standard'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  {
    label: 'teachers / 12 subjects',
    configType: 'standard', studentsKey: '2',
    subjectsCount: 12, withHeadTeacher: true,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found'],
      masterNameSequence: ['F-Head-WithPhoto', 'G-Teachers-4x3', 'E-Student-Standard'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  {
    label: 'teachers / 16 subjects',
    configType: 'standard', studentsKey: '2',
    subjectsCount: 16, withHeadTeacher: true,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found'],
      masterNameSequence: ['F-Head-WithPhoto', 'G-Teachers-4x4', 'E-Student-Standard'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  {
    label: 'teachers / 20 subjects (overflow scenario)',
    configType: 'standard', studentsKey: '2',
    subjectsCount: 20, withHeadTeacher: true,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['subjects_overflow'],
      masterNameSequence: ['F-Head-LargeGrid', 'G-Teachers-4x4', 'E-Student-Standard'],
    },
  },
  {
    label: 'teachers / 28 subjects (degraded — обрезка до 24)',
    configType: 'standard', studentsKey: '2',
    subjectsCount: 28, withHeadTeacher: true,
    expect: {
      spreadsCount: 3,
      warningCodes: ['subjects_overflow'],
      masterNameSequence: ['F-Head-LargeGrid', 'G-Teachers-4x4', 'E-Student-Standard'],
    },
  },
  {
    label: 'teachers / no head_teacher',
    configType: 'standard', studentsKey: '2',
    subjectsCount: 5, withHeadTeacher: false,
    expect: {
      spreadsCount: 1,
      warningCodes: ['no_head_teacher'],
      masterNameSequence: ['E-Student-Standard'],
    },
  },
  // ─── Медиум (0.10b.3) ───
  {
    label: 'medium / 4 students (1 full page)',
    configType: 'medium', studentsKey: '4',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 1,
      noWarningCodes: ['master_not_found', 'students_grid_no_special_master'],
      masterNameSequence: ['D-Medium-Left'],
    },
  },
  {
    label: 'medium / 5 students + full_class (last_spread активен)',
    configType: 'medium', studentsKey: '5_med',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found', 'students_grid_no_special_master', 'class_photo_missing'],
      masterNameSequence: ['D-Medium-Left', 'D-Medium-Last-WithPhoto', 'G-FullClass'],
    },
    commonPhotos: { full_class: ['url-fc-1', 'url-fc-2'] },
  },
  {
    label: 'medium / 5 students no common photos',
    configType: 'medium', studentsKey: '5_med',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 2,
      warningCodes: ['class_photo_missing', 'no_right_teacher_master'],
      masterNameSequence: ['D-Medium-Left', 'D-Medium-Last-WithPhoto'],
    },
  },
  {
    label: 'medium / 7 students (remainder=3, no special master)',
    configType: 'medium', studentsKey: '7',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 2,
      warningCodes: ['students_grid_no_special_master'],
      masterNameSequence: ['D-Medium-Left', 'D-Medium-Right'],
    },
  },
  {
    label: 'medium / 8 students (2 full pages)',
    configType: 'medium', studentsKey: '8',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 2,
      noWarningCodes: ['master_not_found', 'students_grid_no_special_master'],
      masterNameSequence: ['D-Medium-Left', 'D-Medium-Right'],
    },
  },
  {
    label: 'medium / 11 students (remainder=3 на 3-й странице)',
    configType: 'medium', studentsKey: '11',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 3,
      warningCodes: ['students_grid_no_special_master'],
      masterNameSequence: ['D-Medium-Left', 'D-Medium-Right', 'D-Medium-Left'],
    },
  },
  {
    label: 'medium / 13 students + 5 subjects + half',
    configType: 'medium', studentsKey: '13',
    subjectsCount: 5, withHeadTeacher: true,
    expect: {
      spreadsCount: 7,
      noWarningCodes: ['master_not_found', 'class_photo_missing', 'students_grid_no_special_master'],
      masterNameSequence: [
        'F-Head-LargeGrid', 'G-HalfClass',
        'D-Medium-Left', 'D-Medium-Right', 'D-Medium-Left',
        'D-Medium-Last-WithPhoto', 'G-HalfClass',
      ],
    },
    commonPhotos: { half: ['url-h1', 'url-h2'], full_class: ['url-fc-1'] },
  },
  // ─── Soft-печать с S-Intro (0.11.0) ───
  {
    label: 'soft / standard / 6 students + full_class (S-Intro заполнен)',
    configType: 'standard', studentsKey: '6',
    subjectsCount: 0, withHeadTeacher: false,
    printType: 'soft',
    expect: {
      spreadsCount: 4,
      noWarningCodes: ['master_not_found', 'class_photo_missing'],
      masterNameSequence: ['S-Intro', 'E-Student-Standard', 'E-Student-Standard', 'E-Student-Standard'],
    },
    commonPhotos: { full_class: ['url-fc-soft-intro'] },
  },
  {
    label: 'soft / universal / 5 students + full_class (S-Intro заполнен)',
    configType: 'universal', studentsKey: '5',
    subjectsCount: 0, withHeadTeacher: false,
    printType: 'soft',
    expect: {
      spreadsCount: 6,
      noWarningCodes: ['master_not_found', 'class_photo_missing'],
      masterNameSequence: [
        'S-Intro',
        'E-Student-Left', 'E-Student-Right', 'E-Student-Left', 'E-Student-Right', 'E-Student-Left',
      ],
    },
    commonPhotos: { full_class: ['url-fc-soft-intro'] },
  },
  {
    label: 'soft / maximum / 5 students + full_class (S-Intro заполнен)',
    configType: 'maximum', studentsKey: '5',
    subjectsCount: 0, withHeadTeacher: false,
    printType: 'soft',
    expect: {
      spreadsCount: 11,
      noWarningCodes: ['master_not_found', 'class_photo_missing'],
      masterNameSequence: [
        'S-Intro',
        'E-Max-Left', 'E-Max-Right', 'E-Max-Left', 'E-Max-Right', 'E-Max-Left',
        'E-Max-Right', 'E-Max-Left', 'E-Max-Right', 'E-Max-Left', 'E-Max-Right',
      ],
    },
    commonPhotos: { full_class: ['url-fc-soft-intro'] },
  },
  {
    label: 'soft / medium / 8 students + full_class (S-Intro заполнен)',
    configType: 'medium', studentsKey: '8',
    subjectsCount: 0, withHeadTeacher: false,
    printType: 'soft',
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found', 'class_photo_missing'],
      masterNameSequence: ['S-Intro', 'D-Medium-Left', 'D-Medium-Right'],
    },
    commonPhotos: { full_class: ['url-fc-soft-intro'] },
  },
  {
    label: 'soft / standard / 6 students NO common photos (S-Intro classphotoframe=null)',
    configType: 'standard', studentsKey: '6',
    subjectsCount: 0, withHeadTeacher: false,
    printType: 'soft',
    expect: {
      spreadsCount: 4,
      warningCodes: ['class_photo_missing'],
      masterNameSequence: ['S-Intro', 'E-Student-Standard', 'E-Student-Standard', 'E-Student-Standard'],
    },
  },
  // ─── Лайт ≤24 (0.11.1) ───
  // adaptive_grid берёт минимально достаточный мастер. L-6 (students=6) хватает
  // для всех light-классов 1-24 (max requiredCapacity = ceil(24/4) = 6).
  // adaptive_grid_fallback срабатывал бы только если бы максимально доступный
  // мастер был недостаточен — здесь это не так.
  {
    label: 'light / 1 student (L-6 без warnings)',
    configType: 'light', studentsKey: '1',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 1,
      noWarningCodes: ['adaptive_grid_fallback', 'master_not_found'],
      masterNameSequence: ['L-6-Left'],
    },
  },
  {
    label: 'light / 8 students (L-6 без warnings)',
    configType: 'light', studentsKey: '8',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 2,
      noWarningCodes: ['adaptive_grid_fallback', 'master_not_found'],
      masterNameSequence: ['L-6-Left', 'L-6-Right'],
    },
  },
  {
    label: 'light / 24 students (полный класс — L-6 без warnings)',
    configType: 'light', studentsKey: '24',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 4,
      noWarningCodes: ['adaptive_grid_fallback', 'master_not_found', 'students_overflow'],
      masterNameSequence: ['L-6-Left', 'L-6-Right', 'L-6-Left', 'L-6-Right'],
    },
  },
  // ─── Мини ≤24 (0.11.1) ───
  // L-6 и N-12 оба матчат mini (applies_to_configs общеупотребимы). adaptive_grid
  // берёт МИНИМАЛЬНО достаточный: при requiredCapacity ≤ 6 — это L-6, иначе N-12.
  {
    label: 'mini / 8 students (N-12 default для mini, 1 страница)',
    configType: 'mini', studentsKey: '8',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 1,
      noWarningCodes: ['adaptive_grid_fallback', 'master_not_found'],
      masterNameSequence: ['N-12-Left'],
    },
  },
  {
    label: 'mini / 18 students (N-12, L-6 недостаточен для required=9)',
    configType: 'mini', studentsKey: '18',
    subjectsCount: 0, withHeadTeacher: false,
    // required=ceil(18/2)=9. L-6 (6) недостаточен, N-12 (12) выбран.
    expect: {
      spreadsCount: 2,
      noWarningCodes: ['adaptive_grid_fallback', 'master_not_found'],
      masterNameSequence: ['N-12-Left', 'N-12-Right'],
    },
  },
  {
    label: 'mini / 24 students (полный — N-12 без warnings)',
    configType: 'mini', studentsKey: '24',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 2,
      noWarningCodes: ['adaptive_grid_fallback', 'master_not_found', 'students_overflow'],
      masterNameSequence: ['N-12-Left', 'N-12-Right'],
    },
  },
  // ─── Soft варианты Лайт/Мини (S-Intro в начале) ───
  {
    label: 'soft / light / 24 students + full_class (S-Intro + 4 страницы)',
    configType: 'light', studentsKey: '24',
    subjectsCount: 0, withHeadTeacher: false,
    printType: 'soft',
    expect: {
      spreadsCount: 5,
      noWarningCodes: ['adaptive_grid_fallback', 'class_photo_missing'],
      masterNameSequence: ['S-Intro', 'L-6-Left', 'L-6-Right', 'L-6-Left', 'L-6-Right'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  {
    label: 'soft / mini / 24 students NO head_teacher (Mini-soft без S-Intro)',
    configType: 'mini', studentsKey: '24',
    subjectsCount: 0, withHeadTeacher: false,
    printType: 'soft',
    expect: {
      spreadsCount: 2,
      warningCodes: ['no_head_teacher'],
      noWarningCodes: ['master_not_found'],
      masterNameSequence: ['N-12-Left', 'N-12-Right'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  // ─── Лайт с учителями ───
  {
    label: 'light / 24 students + 5 subjects + half (учителя + 4 grid)',
    configType: 'light', studentsKey: '24',
    subjectsCount: 5, withHeadTeacher: true,
    expect: {
      spreadsCount: 6,
      noWarningCodes: ['adaptive_grid_fallback', 'master_not_found'],
      masterNameSequence: [
        'F-Head-LargeGrid', 'G-HalfClass',
        'L-6-Left', 'L-6-Right', 'L-6-Left', 'L-6-Right',
      ],
    },
    commonPhotos: { half: ['url-h1', 'url-h2'] },
  },
  // ─── Лайт overflow (0.11.2) ───
  {
    label: 'light / 27 students no full_class (warning class_photo_missing)',
    configType: 'light', studentsKey: '27',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 5,
      warningCodes: ['class_photo_missing'],
      masterNameSequence: ['L-6-Left', 'L-6-Right', 'L-6-Left', 'L-6-Right', 'L-Overflow-Row'],
    },
  },
  {
    label: 'light / 27 students + full_class (overflow_row заполнен)',
    configType: 'light', studentsKey: '27',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 5,
      noWarningCodes: ['master_not_found', 'students_overflow', 'class_photo_missing'],
      masterNameSequence: ['L-6-Left', 'L-6-Right', 'L-6-Left', 'L-6-Right', 'L-Overflow-Row'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  {
    label: 'light / 28 students (overflow 4 → extra L-6-Left неполная)',
    configType: 'light', studentsKey: '28',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 5,
      noWarningCodes: ['master_not_found', 'students_overflow', 'class_photo_missing'],
      masterNameSequence: ['L-6-Left', 'L-6-Right', 'L-6-Left', 'L-6-Right', 'L-6-Left'],
    },
  },
  {
    label: 'light / 30 students (overflow 6 → полная extra L-6-Left)',
    configType: 'light', studentsKey: '30',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 5,
      noWarningCodes: ['master_not_found', 'students_overflow', 'class_photo_missing'],
      masterNameSequence: ['L-6-Left', 'L-6-Right', 'L-6-Left', 'L-6-Right', 'L-6-Left'],
    },
  },
  {
    label: 'light / 32 students + full_class (extra grid + L-Overflow-Row-Right)',
    configType: 'light', studentsKey: '32',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 6,
      noWarningCodes: ['master_not_found', 'students_overflow', 'class_photo_missing'],
      masterNameSequence: [
        'L-6-Left', 'L-6-Right', 'L-6-Left', 'L-6-Right',
        'L-6-Left',
        'L-Overflow-Row-Right',
      ],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  // ─── Мини overflow (0.11.2) ───
  {
    label: 'mini / 26 students + full_class (overflow 2 → N-Overflow-Row)',
    configType: 'mini', studentsKey: '26',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found', 'students_overflow', 'class_photo_missing'],
      masterNameSequence: ['N-12-Left', 'N-12-Right', 'N-Overflow-Row'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  {
    label: 'mini / 29 students (overflow 5 → extra N-12-Left неполная)',
    configType: 'mini', studentsKey: '29',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found', 'students_overflow', 'class_photo_missing'],
      masterNameSequence: ['N-12-Left', 'N-12-Right', 'N-12-Left'],
    },
  },
  {
    label: 'mini / 36 students (overflow 12 → полная extra N-12-Left)',
    configType: 'mini', studentsKey: '36',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found', 'students_overflow', 'class_photo_missing'],
      masterNameSequence: ['N-12-Left', 'N-12-Right', 'N-12-Left'],
    },
  },
  // ─── Индивидуальный (0.11.3) ───
  {
    label: 'individual / 3 students no friend_photos',
    configType: 'individual', studentsKey: '3',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 7,
      noWarningCodes: ['master_not_found', 'students_overflow'],
      masterNameSequence: [
        'E-Max-Left', 'E-Ind-Right-3',
        'E-Max-Left', 'E-Ind-Right-3',
        'E-Max-Left', 'E-Ind-Right-3',
        'N-12-Left',
      ],
    },
  },
  {
    label: 'individual / 5 students all 4 friend_photos (E-Max-Right)',
    configType: 'individual', studentsKey: '5_with_friends',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 11,
      noWarningCodes: ['master_not_found', 'students_overflow'],
      masterNameSequence: [
        'E-Max-Left', 'E-Max-Right',
        'E-Max-Left', 'E-Max-Right',
        'E-Max-Left', 'E-Max-Right',
        'E-Max-Left', 'E-Max-Right',
        'E-Max-Left', 'E-Max-Right',
        'N-12-Left',
      ],
    },
  },
  {
    label: 'individual / 5 students mixed (3×E-Ind + 2×E-Max-Right)',
    configType: 'individual', studentsKey: '5_mixed_friends',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 11,
      noWarningCodes: ['master_not_found', 'students_overflow'],
      masterNameSequence: [
        'E-Max-Left', 'E-Ind-Right-3',
        'E-Max-Left', 'E-Ind-Right-3',
        'E-Max-Left', 'E-Ind-Right-3',
        'E-Max-Left', 'E-Max-Right',
        'E-Max-Left', 'E-Max-Right',
        'N-12-Left',
      ],
    },
  },
  {
    label: 'individual / 24 students (полная сетка миниатюр)',
    configType: 'individual', studentsKey: '24',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 50,
      noWarningCodes: ['master_not_found', 'students_overflow'],
    },
  },
  {
    label: 'individual / 26 students + full_class (overflow в миниатюрах)',
    configType: 'individual', studentsKey: '26',
    subjectsCount: 0, withHeadTeacher: false,
    expect: {
      spreadsCount: 55,
      noWarningCodes: ['master_not_found', 'students_overflow', 'class_photo_missing'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  {
    label: 'soft / individual / 5 students no friends + full_class',
    configType: 'individual', studentsKey: '5_med',
    subjectsCount: 0, withHeadTeacher: false,
    printType: 'soft',
    expect: {
      spreadsCount: 12,
      noWarningCodes: ['master_not_found', 'class_photo_missing'],
      masterNameSequence: [
        'S-Intro',
        'E-Max-Left', 'E-Ind-Right-3',
        'E-Max-Left', 'E-Ind-Right-3',
        'E-Max-Left', 'E-Ind-Right-3',
        'E-Max-Left', 'E-Ind-Right-3',
        'E-Max-Left', 'E-Ind-Right-3',
        'N-12-Left',
      ],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  {
    label: 'individual / 3 students + 4 subjects + half',
    configType: 'individual', studentsKey: '3',
    subjectsCount: 4, withHeadTeacher: true,
    expect: {
      spreadsCount: 9,
      noWarningCodes: ['master_not_found'],
      masterNameSequence: [
        'F-Head-SmallGrid', 'G-HalfClass',
        'E-Max-Left', 'E-Ind-Right-3',
        'E-Max-Left', 'E-Ind-Right-3',
        'E-Max-Left', 'E-Ind-Right-3',
        'N-12-Left',
      ],
    },
    commonPhotos: { half: ['url-h1', 'url-h2'] },
  },
  // ─── Mini-soft (0.11.4) ───
  {
    label: 'soft / mini / 8 students + 0 subjects + full_class (Mini-soft без S-Intro, F-WithPhoto-R)',
    configType: 'mini', studentsKey: '8',
    subjectsCount: 0, withHeadTeacher: true,
    printType: 'soft',
    expect: {
      spreadsCount: 2,
      noWarningCodes: ['master_not_found', 'class_photo_missing'],
      masterNameSequence: ['F-Head-WithPhoto-R', 'N-12-Left'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
  {
    label: 'soft / mini / 18 students + 4 subjects (F-SmallGrid-R)',
    configType: 'mini', studentsKey: '18',
    subjectsCount: 4, withHeadTeacher: true,
    printType: 'soft',
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found'],
      masterNameSequence: ['F-Head-SmallGrid-R', 'N-12-Left', 'N-12-Right'],
    },
  },
  {
    label: 'soft / mini / 24 students + 8 subjects (F-LargeGrid-R)',
    configType: 'mini', studentsKey: '24',
    subjectsCount: 8, withHeadTeacher: true,
    printType: 'soft',
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found'],
      masterNameSequence: ['F-Head-LargeGrid-R', 'N-12-Left', 'N-12-Right'],
    },
  },
  {
    label: 'soft / mini / 12 students + 12 subjects (degraded — обрезка до 8)',
    configType: 'mini', studentsKey: '12',
    subjectsCount: 12, withHeadTeacher: true,
    printType: 'soft',
    expect: {
      spreadsCount: 2,
      warningCodes: ['subjects_overflow'],
      masterNameSequence: ['F-Head-LargeGrid-R', 'N-12-Left'],
    },
  },
  {
    label: 'soft / mini / 8 students NO head_teacher',
    configType: 'mini', studentsKey: '8',
    subjectsCount: 0, withHeadTeacher: false,
    printType: 'soft',
    expect: {
      spreadsCount: 1,
      warningCodes: ['no_head_teacher'],
      noWarningCodes: ['master_not_found'],
      masterNameSequence: ['N-12-Left'],
    },
  },
  {
    label: 'soft / mini / 26 students + 0 subjects + full_class (overflow + Mini-soft)',
    configType: 'mini', studentsKey: '26',
    subjectsCount: 0, withHeadTeacher: true,
    printType: 'soft',
    expect: {
      spreadsCount: 4,
      noWarningCodes: ['master_not_found', 'class_photo_missing'],
      masterNameSequence: ['F-Head-WithPhoto-R', 'N-12-Left', 'N-12-Right', 'N-Overflow-Row'],
    },
    commonPhotos: { full_class: ['url-fc-1', 'url-fc-2'] },
  },
  // Контрольная: Mini-layflat — должна остаться двухстраничной (F + G)
  {
    label: 'mini / 8 students + 4 subjects + full_class (LAYFLAT — обычная учительская)',
    configType: 'mini', studentsKey: '8',
    subjectsCount: 4, withHeadTeacher: true,
    expect: {
      spreadsCount: 3,
      noWarningCodes: ['master_not_found'],
      masterNameSequence: ['F-Head-SmallGrid', 'G-FullClass', 'N-12-Left'],
    },
    commonPhotos: { full_class: ['url-fc-1'] },
  },
];

// ─── Запуск ─────────────────────────────────────────────────────────────────

function buildInput(scene: Scene, ts: TemplateSet): AlbumInput {
  const students = scene.label.includes('empty') ? [] : STUDENT_SETS[scene.studentsKey];
  return {
    template_set_id: ts.id,
    head_teacher: scene.withHeadTeacher ? HEAD_TEACHER : null,
    subjects: makeSubjects(scene.subjectsCount),
    students,
    common_photos: {
      full_class: scene.commonPhotos?.full_class ?? [],
      half: scene.commonPhotos?.half ?? [],
      quarter: scene.commonPhotos?.quarter ?? [],
      sixth: scene.commonPhotos?.sixth ?? [],
      collage: scene.commonPhotos?.collage ?? [],
    },
  };
}

async function runScene(scene: Scene, ts: TemplateSet): Promise<{ passed: boolean; lines: string[] }> {
  const lines: string[] = [];
  const input = buildInput(scene, ts);
  const printType = scene.printType ?? 'layflat';
  const slug = `${scene.configType}-${printType}`;
  const preset = await getPreset(slug);

  let result;
  try {
    result = buildAlbum(input, preset, ts);
  } catch (e) {
    lines.push(`  ❌ THROW: ${(e as Error).message}`);
    return { passed: false, lines };
  }

  lines.push(`  spreads: ${result.spreads.length}`);
  result.spreads.forEach((s) => {
    lines.push(`    [${s.spread_index}] ${s.template_name}`);
  });
  if (result.warnings.length > 0) {
    lines.push(`  warnings: ${result.warnings.length}`);
    result.warnings.forEach((w) => lines.push(`    ! ${w.code}: ${w.detail}`));
  }

  // Проверки expect
  let passed = true;
  const fail = (msg: string) => {
    lines.push(`  ❌ ${msg}`);
    passed = false;
  };

  if (scene.expect.spreadsCount !== undefined && result.spreads.length !== scene.expect.spreadsCount) {
    fail(`expected spreads=${scene.expect.spreadsCount}, got ${result.spreads.length}`);
  }
  if (scene.expect.spreadsCountAtLeast !== undefined && result.spreads.length < scene.expect.spreadsCountAtLeast) {
    fail(`expected spreads>=${scene.expect.spreadsCountAtLeast}, got ${result.spreads.length}`);
  }
  const codes: string[] = result.warnings.map((w) => w.code);
  scene.expect.warningCodes?.forEach((c) => {
    if (codes.indexOf(c) < 0) fail(`expected warning '${c}', not found`);
  });
  scene.expect.noWarningCodes?.forEach((c) => {
    if (codes.indexOf(c) >= 0) fail(`unexpected warning '${c}'`);
  });
  if (scene.expect.masterNameSequence) {
    const got = result.spreads.map((s) => s.template_name);
    const exp = scene.expect.masterNameSequence;
    const match = got.length === exp.length && got.every((n, i) => n === exp[i]);
    if (!match) fail(`expected sequence ${JSON.stringify(exp)}, got ${JSON.stringify(got)}`);
  }
  if (passed) lines.push(`  ✅ passed`);
  return { passed, lines };
}

async function main() {
  const filterArg = process.argv[2];
  const filter = filterArg ? filterArg.split(',').map((s) => s.trim()) : null;

  const ts = await loadTemplateSet(supabase);
  console.log(`Loaded template_set okeybook-default with ${ts.spreads.length} spreads`);
  console.log('');

  const scenes = filter
    ? SCENES.filter((s) => filter.indexOf(s.configType) >= 0 || filter.indexOf(s.label) >= 0)
    : SCENES;

  let total = 0;
  let passed = 0;
  for (const scene of scenes) {
    total++;
    console.log(`=== ${scene.label} ===`);
    const r = await runScene(scene, ts);
    r.lines.forEach((l) => console.log(l));
    if (r.passed) passed++;
    console.log('');
  }

  console.log(`Result: ${passed}/${total} scenes passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
