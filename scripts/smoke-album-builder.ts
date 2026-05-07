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
import { buildAlbum } from '../lib/album-builder';
import type {
  AlbumInput,
  Config,
  TemplateSet,
  ConfigType,
  Student,
  Subject,
  HeadTeacher,
  CommonPhotos,
} from '../lib/album-builder';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function loadTemplateSet(): Promise<TemplateSet> {
  const { data: ts, error: e1 } = await supabase
    .from('template_sets')
    .select('*')
    .eq('slug', 'okeybook-default')
    .single();
  if (e1 || !ts) throw new Error('template_set not found: ' + (e1?.message ?? 'no row'));

  const { data: spreads, error: e2 } = await supabase
    .from('spread_templates')
    .select('*')
    .eq('template_set_id', ts.id)
    .order('sort_order');
  if (e2 || !spreads) throw new Error('spread_templates not loaded: ' + (e2?.message ?? 'empty'));

  return { ...ts, spreads } as TemplateSet;
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
  '2': [makeStudent('Алексеев', 4), makeStudent('Бочкарёв', 4)],
  '5': STUDENTS_5,
  '6': [...STUDENTS_5, makeStudent('Егоров', 4)],
  '24': Array.from({ length: 24 }, (_, i) => makeStudent(`Ученик${i + 1}`, 2)),
  '27': Array.from({ length: 27 }, (_, i) => makeStudent(`Ученик${i + 1}`, 2)),
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
  // ─── Заготовка для 0.10b.3 — раскомментировать по мере реализации Медиума ───
  //
  // {
  //   label: 'medium / 24 students (для 0.10b.3)',
  //   configType: 'medium', studentsKey: '24',
  //   subjectsCount: 0, withHeadTeacher: false,
  //   expect: { spreadsCount: 6 /* 24/4 = 6 страниц */ },
  // },
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

function runScene(scene: Scene, ts: TemplateSet): { passed: boolean; lines: string[] } {
  const lines: string[] = [];
  const input = buildInput(scene, ts);
  const config: Config = {
    print_type: 'layflat',
    config_type: scene.configType,
    template_set: ts,
  };

  let result;
  try {
    result = buildAlbum(input, config);
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

  const ts = await loadTemplateSet();
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
    const r = runScene(scene, ts);
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
