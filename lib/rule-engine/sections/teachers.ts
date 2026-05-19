/**
 * Заполнение секции type='teachers' для buildFromSectionStructure.
 *
 * Семантика выбора F-Head-* (левая) и G-* (правая) — из таблицы
 * docs/album-structure-inventory.md §3:
 *
 *   subjects | левая (F-Head-*)         | правая (G-*)
 *   ─────────┼──────────────────────────┼──────────────────────────────────
 *   0        | F-Head-WithPhoto         | G-HalfClass / G-FullClass / пусто
 *   1-4      | F-Head-SmallGrid         | то же правило справа
 *   5-8      | F-Head-LargeGrid         | то же правило справа
 *   9        | F-Head-WithPhoto         | G-Teachers-3x3 (9 слотов)
 *   10-12    | F-Head-WithPhoto         | G-Teachers-4x3 (12 слотов)
 *   13-16    | F-Head-WithPhoto         | G-Teachers-4x4 (16 слотов)
 *   17+      | F-Head-LargeGrid (8 sub) | G-Teachers-4x4 (остаток до 16)
 *
 * Правая страница для subjects ≤ 8 — общее фото класса. Цепочка:
 *   1. G-HalfClass если half_class ≥ 2 (consume 2)
 *   2. G-FullClass если full_class ≥ 1 (consume 1)
 *   3. иначе → правая страница НЕ создаётся, секция занимает 1 страницу
 *      (F-* одиночно). Следующая секция начнётся с правой позиции.
 *
 * Bindings: best-effort через placeholder-driven mapping. Читаем
 * master.placeholders и для каждого label решаем что туда положить.
 * Неизвестные labels оставляются пустыми (Konva canvas/PDF покажет
 * placeholder из IDML). Точное соответствие labels между slot-chains
 * именами мастеров и реальным template_set okeybook-default проверим
 * в РЭ.21.8.6 на боевых данных.
 *
 * Положение в альбоме: предполагается, что учительский разворот идёт
 * с левой страницы (pageIndex чётный). Если pageIndex нечётный
 * (висящая правая после soft_intro/teachers, например) — секция всё
 * равно отрабатывает, но F-* попадает на правую страницу, G-* на
 * следующую левую. Это нештатный случай, на корректность визуала
 * не влияет (просто другая позиция).
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import type {
  RulesAlbumInput,
  RulesHeadTeacherInput,
  RulesSubjectInput,
} from '../types';
import type { CommonPhotoCounts } from '../slot-chains';
import type { SectionFillContext } from './shared';

interface LeftChoice {
  masterName: string;
  /** Сколько subjects класть на левой странице (для F-Head-SmallGrid/LargeGrid). */
  subjectsCount: number;
}

interface RightChoice {
  masterName: string;
  /** Сколько subjects класть на правой странице (для G-Teachers-*). */
  subjectsCount: number;
  /** С какого индекса subjects начинать (для 17+ — 8). */
  subjectsOffset: number;
  /** Сколько общих фото потребит мастер (для G-HalfClass/FullClass). */
  consumes: { full_class?: number; half_class?: number };
}

export function fillTeachersSection(ctx: SectionFillContext): void {
  const subjects = ctx.input.subjects;
  const subjectsCount = subjects.length;

  const left = pickLeftMaster(subjectsCount);
  const right = pickRightMaster(subjectsCount, ctx.input.common_photos);

  // ─── Левая страница: F-Head-* ─────────────────────────────────────────────
  const leftMaster = ctx.bundle.mastersByName.get(left.masterName);
  if (!leftMaster) {
    ctx.warnings.push(
      `teachers_master_not_found: '${left.masterName}' отсутствует в template_set дизайна`,
    );
    return;
  }

  const leftBindings = bindLeftPage(
    leftMaster,
    ctx.input.head_teacher,
    subjects.slice(0, left.subjectsCount),
  );

  const leftPageIndex = ctx.pageInstances.length;
  ctx.pageInstances.push({ master_id: leftMaster.id, bindings: leftBindings });
  ctx.decisionTrace.push({
    spread_index: Math.floor(leftPageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'head-teacher',
    rule_id: `teachers_left:${left.masterName}`,
    inputs: {
      subjects_count: subjectsCount,
      subjects_on_left: left.subjectsCount,
    },
  });

  // ─── Правая страница: G-* (опционально) ───────────────────────────────────
  if (right === null) {
    // subjects ≤ 8 и нет общих фото → одиночная страница F-* без правой.
    ctx.warnings.push(
      `teachers_right_empty: нет общих фото для правой страницы (subjects=${subjectsCount})`,
    );
    return;
  }

  const rightMaster = ctx.bundle.mastersByName.get(right.masterName);
  if (!rightMaster) {
    ctx.warnings.push(
      `teachers_master_not_found: '${right.masterName}' отсутствует в template_set дизайна`,
    );
    return;
  }

  // Bindings ДО consumes — внутри используется
  // `used = arr.length - available[k]` как индекс «первого ещё
  // неиспользованного фото». Если бы decrement шёл первым, used сдвинулся бы
  // на consumes раньше срока и взяли бы фото за пределами незатронутого пула.
  const rightBindings = bindRightPage(
    rightMaster,
    right,
    ctx.input,
    ctx.available,
    subjects,
  );

  // Теперь применяем consumes к available.
  if (right.consumes.full_class)
    ctx.available.full_class -= right.consumes.full_class;
  if (right.consumes.half_class)
    ctx.available.half_class -= right.consumes.half_class;

  const rightPageIndex = ctx.pageInstances.length;
  ctx.pageInstances.push({
    master_id: rightMaster.id,
    bindings: rightBindings,
  });
  ctx.decisionTrace.push({
    spread_index: Math.floor(rightPageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'head-teacher',
    rule_id: `teachers_right:${right.masterName}`,
    inputs: {
      subjects_count: subjectsCount,
      subjects_on_right: right.subjectsCount,
      subjects_offset: right.subjectsOffset,
      consumes: right.consumes,
    },
  });
}

// ─── Выбор мастеров ────────────────────────────────────────────────────────

function pickLeftMaster(subjects: number): LeftChoice {
  if (subjects === 0) {
    return { masterName: 'F-Head-WithPhoto', subjectsCount: 0 };
  }
  if (subjects <= 4) {
    return { masterName: 'F-Head-SmallGrid', subjectsCount: subjects };
  }
  if (subjects <= 8) {
    return { masterName: 'F-Head-LargeGrid', subjectsCount: subjects };
  }
  // 9..16: предметники полностью на правой (G-Teachers-*), левая = F-Head-WithPhoto
  if (subjects <= 16) {
    return { masterName: 'F-Head-WithPhoto', subjectsCount: 0 };
  }
  // 17+: 8 на левой (LargeGrid), остаток на правой
  return { masterName: 'F-Head-LargeGrid', subjectsCount: 8 };
}

function pickRightMaster(
  subjects: number,
  commonPhotos: RulesAlbumInput['common_photos'],
): RightChoice | null {
  // subjects ≤ 8: правая = общее фото
  if (subjects <= 8) {
    if (commonPhotos.half_class.length >= 2) {
      return {
        masterName: 'G-HalfClass',
        subjectsCount: 0,
        subjectsOffset: 0,
        consumes: { half_class: 2 },
      };
    }
    if (commonPhotos.full_class.length >= 1) {
      return {
        masterName: 'G-FullClass',
        subjectsCount: 0,
        subjectsOffset: 0,
        consumes: { full_class: 1 },
      };
    }
    return null;
  }
  // 9: G-Teachers-3x3 (9 слотов)
  if (subjects === 9) {
    return {
      masterName: 'G-Teachers-3x3',
      subjectsCount: 9,
      subjectsOffset: 0,
      consumes: {},
    };
  }
  // 10-12: G-Teachers-4x3 (12 слотов)
  if (subjects <= 12) {
    return {
      masterName: 'G-Teachers-4x3',
      subjectsCount: subjects,
      subjectsOffset: 0,
      consumes: {},
    };
  }
  // 13-16: G-Teachers-4x4 (16 слотов)
  if (subjects <= 16) {
    return {
      masterName: 'G-Teachers-4x4',
      subjectsCount: subjects,
      subjectsOffset: 0,
      consumes: {},
    };
  }
  // 17+: остаток (до 16) на G-Teachers-4x4, начиная с offset=8
  return {
    masterName: 'G-Teachers-4x4',
    subjectsCount: Math.min(16, subjects - 8),
    subjectsOffset: 8,
    consumes: {},
  };
}

// ─── Bindings ──────────────────────────────────────────────────────────────

/**
 * Bindings для левой страницы (F-Head-*).
 *
 * Маппинг ведётся placeholder-driven: проходим по `master.placeholders`,
 * для каждого `label` решаем что туда подставить. Неизвестные labels
 * не попадают в bindings — Konva canvas покажет placeholder из IDML.
 *
 * Поддерживаемые labels (case-insensitive, регекс-матч):
 *  - `headteacherphoto`            → photo
 *  - `headteachername`             → name
 *  - `headteacherrole`             → role
 *  - `headteachertext` / `…quote`  → text
 *  - `subjectphoto_N` / `subject_N` / `teacherphoto_N` → subjects[N-1].photo
 *  - `subjectname_N` / `teachername_N` → subjects[N-1].name
 *  - `subjectrole_N` / `teacherrole_N` → subjects[N-1].role
 */
function bindLeftPage(
  master: SpreadTemplate,
  headTeacher: RulesHeadTeacherInput,
  subjects: RulesSubjectInput[],
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    const label = ph.label.toLowerCase();

    // ─ Главный учитель ─
    if (label === 'headteacherphoto') {
      if (headTeacher.photo) {
        bindings[ph.label] = headTeacher.photo;
      } else {
        // РЭ.21.8.13: главное фото учителя отсутствует → скрываем рамку,
        // чтобы Canvas/PDF не рисовал пустой прямоугольник.
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    if (label === 'headteachername') {
      bindings[ph.label] = headTeacher.name;
      continue;
    }
    if (label === 'headteacherrole') {
      bindings[ph.label] = headTeacher.role;
      continue;
    }
    if (label === 'headteachertext' || label === 'headteacherquote') {
      bindings[ph.label] = headTeacher.text;
      continue;
    }

    // ─ Предметники ─
    // РЭ.21.8.13: если subject_N отсутствует (subjects короче чем слотов
    // в мастере) или у subject нет нужного поля — выставляем __hidden__
    // для конкретного label. Это скрывает слот целиком (фото + имя + роль),
    // но скрытие происходит per-label а не группой, потому что balance-
    // overrides модель работает per-placeholder.
    const photoMatch = label.match(/^(?:subjectphoto|subject|teacherphoto)_(\d+)$/);
    if (photoMatch) {
      const n = parseInt(photoMatch[1], 10);
      const subj = subjects[n - 1];
      if (subj && subj.photo) {
        bindings[ph.label] = subj.photo;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    const nameMatch = label.match(/^(?:subjectname|teachername)_(\d+)$/);
    if (nameMatch) {
      const n = parseInt(nameMatch[1], 10);
      const subj = subjects[n - 1];
      if (subj) {
        bindings[ph.label] = subj.name;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    const roleMatch = label.match(/^(?:subjectrole|teacherrole)_(\d+)$/);
    if (roleMatch) {
      const n = parseInt(roleMatch[1], 10);
      const subj = subjects[n - 1];
      if (subj) {
        bindings[ph.label] = subj.role;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
  }
  return bindings;
}

/**
 * Bindings для правой страницы.
 *
 * Поведение зависит от выбранного G-* мастера:
 *  - G-HalfClass: `halfphoto_1`, `halfphoto_2` → первые ещё неиспользованные
 *    2 фото half_class (учитываем что какие-то могли быть потреблены раньше)
 *  - G-FullClass: `classphotoframe` → первое ещё неиспользованное фото full_class
 *  - G-Teachers-*: `teacherphoto_N` / `teachername_N` / `teacherrole_N`
 *    → subjects[offset + N - 1] (учитываем subjectsOffset для 17+)
 *
 * Индекс ещё неиспользованного фото в категории `k` определяется через
 * `arr.length - available[k]` — это число уже потреблённых фото. Так combined
 * pages и common-section далее в альбоме не возьмут то же самое фото
 * (см. РЭ.21.8.4c).
 *
 * Чтобы не плодить ветвление по masterName, идём placeholder-driven —
 * для каждого label мастера решаем что положить. Если у G-HalfClass
 * есть label `teacherphoto_1` (не должно быть, но мало ли) — он не
 * сработает, потому что у RightChoice.subjectsCount=0.
 */
function bindRightPage(
  master: SpreadTemplate,
  choice: RightChoice,
  input: RulesAlbumInput,
  available: CommonPhotoCounts,
  allSubjects: RulesSubjectInput[],
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  const subjects = allSubjects.slice(
    choice.subjectsOffset,
    choice.subjectsOffset + choice.subjectsCount,
  );

  // Индексы «первого ещё неиспользованного фото» в каждой категории.
  // = всего − осталось доступно
  const fullClassUsed =
    input.common_photos.full_class.length - available.full_class;
  const halfClassUsed =
    input.common_photos.half_class.length - available.half_class;

  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    const label = ph.label.toLowerCase();

    // ─ Общее фото класса (G-FullClass) ─
    if (label === 'classphotoframe') {
      const photo = input.common_photos.full_class[fullClassUsed];
      if (photo) {
        bindings[ph.label] = photo;
      } else {
        // РЭ.21.8.13: фото full_class не загружено партнёром → скрываем.
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }

    // ─ Полкласса (G-HalfClass) ─
    const halfMatch = label.match(/^halfphoto_(\d+)$/);
    if (halfMatch) {
      const n = parseInt(halfMatch[1], 10);
      const photo = input.common_photos.half_class[halfClassUsed + n - 1];
      if (photo) {
        bindings[ph.label] = photo;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }

    // ─ Сетка предметников (G-Teachers-*) ─
    // Если subjects короче чем мастер ожидает (например 7 предметников
    // при сетке 3x3 = 9 слотов) — скрываем лишние слоты.
    const photoMatch = label.match(/^(?:teacherphoto|subjectphoto|subject)_(\d+)$/);
    if (photoMatch) {
      const n = parseInt(photoMatch[1], 10);
      const subj = subjects[n - 1];
      if (subj && subj.photo) {
        bindings[ph.label] = subj.photo;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    const nameMatch = label.match(/^(?:teachername|subjectname)_(\d+)$/);
    if (nameMatch) {
      const n = parseInt(nameMatch[1], 10);
      const subj = subjects[n - 1];
      if (subj) {
        bindings[ph.label] = subj.name;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    const roleMatch = label.match(/^(?:teacherrole|subjectrole)_(\d+)$/);
    if (roleMatch) {
      const n = parseInt(roleMatch[1], 10);
      const subj = subjects[n - 1];
      if (subj) {
        bindings[ph.label] = subj.role;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
  }

  return bindings;
}
