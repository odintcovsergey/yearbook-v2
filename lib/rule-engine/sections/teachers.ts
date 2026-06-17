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
import { findTeacherMaster } from '../master-finder';
import type {
  RulesAlbumInput,
  RulesHeadTeacherInput,
  RulesSubjectInput,
} from '../types';
import type { CommonPhotoCounts } from '../slot-chains';
import type { SectionFillContext } from './shared';

/**
 * РЭ.22.7.2: семантический выбор мастера для левой/правой стороны
 * учительского разворота.
 *
 * Алгоритм для каждой стороны:
 *  1. Сначала семантический поиск через findTeacherMaster — engine ищет
 *     мастер по тегам page_role + slot_capacity (head_teacher / teachers /
 *     photos_full / photos_half). Это путь приоритета.
 *  2. Если семантика не нашла (template_set не размечен) — fallback на
 *     поиск по жёсткому имени (legacy путь, для template_sets где мастера
 *     ещё не размечены тегами).
 *
 * Результат содержит SpreadTemplate напрямую (а не имя), чтобы caller'у
 * не приходилось ещё раз тянуть его через mastersByName.get.
 */
interface LeftChoice {
  master: SpreadTemplate;
  /** Имя мастера (для decision_trace и warnings). */
  masterName: string;
  /** Сколько subjects класть на левой странице (для F-Head-SmallGrid/LargeGrid). */
  subjectsCount: number;
  /** true если мастер найден через семантический поиск, false — legacy fallback. */
  semantic: boolean;
}

interface RightChoice {
  master: SpreadTemplate;
  masterName: string;
  /** Сколько subjects класть на правой странице (для G-Teachers-*). */
  subjectsCount: number;
  /** С какого индекса subjects начинать (для 17+ — 8). */
  subjectsOffset: number;
  /** Сколько общих фото потребит мастер (для G-HalfClass/FullClass). */
  consumes: { full_class?: number; half_class?: number };
  semantic: boolean;
}

export function fillTeachersSection(ctx: SectionFillContext): void {
  const subjects = ctx.input.subjects;
  const subjectsCount = subjects.length;

  const left = pickLeftMaster(subjectsCount, ctx);
  const right = pickRightMaster(subjectsCount, ctx.input.common_photos, ctx);

  // ─── Левая страница: F-Head-* ─────────────────────────────────────────────
  // pickLeftMaster через resolveTeacherMaster пишет warning сам, если ничего
  // не нашёл. Здесь просто прерываемся.
  if (left === null) return;

  const leftBindings = bindLeftPage(
    left.master,
    ctx.input.head_teacher,
    subjects.slice(0, left.subjectsCount),
  );

  const leftPageIndex = ctx.pageInstances.length;
  ctx.pageInstances.push({ master_id: left.master.id, bindings: leftBindings });
  ctx.decisionTrace.push({
    spread_index: Math.floor(leftPageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'head-teacher',
    rule_id: `teachers_left:${left.masterName}`,
    inputs: {
      subjects_count: subjectsCount,
      subjects_on_left: left.subjectsCount,
      semantic: left.semantic,
    },
  });

  // ─── Правая страница: G-* (опционально) ───────────────────────────────────
  // pickRightMaster пишет warning сам (teachers_right_empty если нет общих
  // фото для ≤8 subjects, teachers_master_not_found через resolveTeacherMaster
  // если мастер не найден). Здесь просто прерываемся при null.
  if (right === null) return;

  // Bindings ДО consumes — внутри используется
  // `used = arr.length - available[k]` как индекс «первого ещё
  // неиспользованного фото». Если бы decrement шёл первым, used сдвинулся бы
  // на consumes раньше срока и взяли бы фото за пределами незатронутого пула.
  const rightBindings = bindRightPage(
    right.master,
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
    master_id: right.master.id,
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
      semantic: right.semantic,
    },
  });
}

// ─── Выбор мастеров ────────────────────────────────────────────────────────

/**
 * РЭ.22.7.2: вспомогательный поиск через семантику с fallback на legacy
 * имя. Используется в pickLeftMaster / pickRightMaster.
 *
 * Возвращает {master, semantic} либо null. semantic=true если найден через
 * findTeacherMaster (т.е. в template_set теги размечены), false если
 * через mastersByName.get(legacyName).
 *
 * Если ни через семантику, ни через legacy мастер не нашёлся —
 * **сам** пушит warning `teachers_master_not_found` со спецификацией.
 * Caller'у достаточно проверить только null/non-null.
 */
function resolveTeacherMaster(
  ctx: SectionFillContext,
  pageRole: 'teacher_left' | 'teacher_right',
  semanticReq: {
    headTeacher?: number;
    teachers?: number;
    photosFull?: number;
    photosHalf?: number;
    match: 'exact' | 'min_fit';
  },
  legacyName: string,
): { master: SpreadTemplate; semantic: boolean } | null {
  // 1) Семантический путь
  const semanticResult = findTeacherMaster(ctx.bundle.mastersByName, {
    presetId: ctx.bundle.preset.id,
    pageRole,
    ...semanticReq,
  });
  if (semanticResult) {
    return { master: semanticResult.master, semantic: true };
  }
  // 2) Legacy fallback по жёсткому имени
  const legacy = ctx.bundle.mastersByName.get(legacyName);
  if (legacy) {
    return { master: legacy, semantic: false };
  }
  // 3) Ни то ни другое — warning со спецификацией
  const specParts: string[] = [`page_role='${pageRole}'`];
  if (semanticReq.headTeacher !== undefined)
    specParts.push(`head_teacher=${semanticReq.headTeacher}`);
  if (semanticReq.teachers !== undefined)
    specParts.push(
      `teachers${semanticReq.match === 'exact' ? '=' : '>='}${semanticReq.teachers}`,
    );
  if (semanticReq.photosFull !== undefined)
    specParts.push(`photos_full=${semanticReq.photosFull}`);
  if (semanticReq.photosHalf !== undefined)
    specParts.push(`photos_half=${semanticReq.photosHalf}`);
  ctx.warnings.push(
    `teachers_master_not_found: '${legacyName}' отсутствует в template_set ` +
      `и не найден семантический мастер с {${specParts.join(', ')}}. ` +
      `Закажите мастер у дизайнера.`,
  );
  return null;
}

/**
 * Компактная правая сетка предметников (G-Teachers-3x2, 6 слотов) для классов
 * с 5-8 предметниками — набор «Аква меч».
 *
 * Идея: некоторые дизайны кладут главного учителя одного на левую, а
 * предметников — в компактную сетку справа (3x2), вместо того чтобы паковать
 * всё на левую F-Head-LargeGrid (8 слотов). Включается ТОЛЬКО когда в наборе
 * есть подходящая правая сетка — иначе старый путь (LargeGrid слева) не
 * меняется (okeybook-default не ломается).
 *
 * Как отличаем «компактную» сетку от крупной (3x3/3x4/4x4): берём min_fit по
 * числу предметников среди teacher_right и принимаем результат ТОЛЬКО если его
 * ёмкость < 9. Крупные сетки (cap ≥ 9) принадлежат тиру 9+ — для 5-8
 * предметников при их наличии остаёмся на LargeGrid слева (как раньше).
 *
 * Возвращает мастер или null. Вызывается из pickLeftMaster и pickRightMaster
 * с тем же subjects → решение согласовано на обеих сторонах.
 */
function findCompactSubjectRightGrid(
  ctx: SectionFillContext,
  subjects: number,
): SpreadTemplate | null {
  const r = findTeacherMaster(ctx.bundle.mastersByName, {
    presetId: ctx.bundle.preset.id,
    pageRole: 'teacher_right',
    teachers: subjects,
    match: 'min_fit',
  });
  if (!r) return null;
  const cap =
    typeof r.master.slot_capacity?.teachers === 'number'
      ? r.master.slot_capacity.teachers
      : 0;
  return cap < 9 ? r.master : null;
}

/**
 * РЭ.22.7.2: выбор мастера левой страницы учительского разворота.
 *
 * Семантика по числу subjects (таблица из docs/album-structure-inventory.md §3):
 *   0     → F-Head-WithPhoto    (headTeacher=1, teachers=0)
 *   1-4   → F-Head-SmallGrid    (headTeacher=1, teachers=subjects, min_fit)
 *   5-8   → F-Head-LargeGrid    (headTeacher=1, teachers=subjects, min_fit)
 *   9-16  → F-Head-WithPhoto    (только главный, subjects идут на правую)
 *   17+   → F-Head-LargeGrid    (headTeacher=1, teachers=8 на левой)
 *
 * Семантический запрос всегда указывает photos_full=0, чтобы отсеять
 * F-Head-WithClassPhoto-L (head=1, photos_full=1) — он не используется
 * в этой таблице (его задействуем в будущей оптимизации).
 */
function pickLeftMaster(
  subjects: number,
  ctx: SectionFillContext,
): LeftChoice | null {
  if (subjects === 0) {
    const r = resolveTeacherMaster(
      ctx,
      'teacher_left',
      { headTeacher: 1, teachers: 0, photosFull: 0, match: 'exact' },
      'F-Head-WithPhoto',
    );
    if (!r) return null;
    return {
      master: r.master,
      masterName: r.master.name,
      subjectsCount: 0,
      semantic: r.semantic,
    };
  }
  if (subjects <= 4) {
    const r = resolveTeacherMaster(
      ctx,
      'teacher_left',
      { headTeacher: 1, teachers: subjects, photosFull: 0, match: 'min_fit' },
      'F-Head-SmallGrid',
    );
    if (!r) return null;
    return {
      master: r.master,
      masterName: r.master.name,
      subjectsCount: subjects,
      semantic: r.semantic,
    };
  }
  if (subjects <= 8) {
    // Аква-меч: если есть компактная правая сетка (3x2) — главный учитель
    // один на левую (как 9-16), предметники уходят на правую сетку.
    if (findCompactSubjectRightGrid(ctx, subjects)) {
      const r = resolveTeacherMaster(
        ctx,
        'teacher_left',
        { headTeacher: 1, teachers: 0, photosFull: 0, match: 'exact' },
        'F-Head-WithPhoto',
      );
      if (!r) return null;
      return {
        master: r.master,
        masterName: r.master.name,
        subjectsCount: 0,
        semantic: r.semantic,
      };
    }
    // Иначе старый путь: предметники на левой (F-Head-LargeGrid).
    const r = resolveTeacherMaster(
      ctx,
      'teacher_left',
      { headTeacher: 1, teachers: subjects, photosFull: 0, match: 'min_fit' },
      'F-Head-LargeGrid',
    );
    if (!r) return null;
    return {
      master: r.master,
      masterName: r.master.name,
      subjectsCount: subjects,
      semantic: r.semantic,
    };
  }
  // 9..16: предметники полностью на правой, левая — только главный.
  if (subjects <= 16) {
    const r = resolveTeacherMaster(
      ctx,
      'teacher_left',
      { headTeacher: 1, teachers: 0, photosFull: 0, match: 'exact' },
      'F-Head-WithPhoto',
    );
    if (!r) return null;
    return {
      master: r.master,
      masterName: r.master.name,
      subjectsCount: 0,
      semantic: r.semantic,
    };
  }
  // 17+: 8 предметников на левой (LargeGrid), остаток на правой.
  const r = resolveTeacherMaster(
    ctx,
    'teacher_left',
    { headTeacher: 1, teachers: 8, photosFull: 0, match: 'min_fit' },
    'F-Head-LargeGrid',
  );
  if (!r) return null;
  return {
    master: r.master,
    masterName: r.master.name,
    subjectsCount: 8,
    semantic: r.semantic,
  };
}

/**
 * РЭ.22.7.2: выбор мастера правой страницы учительского разворота.
 *
 * Семантика по числу subjects + наличию общих фото:
 *   ≤8 + half_class≥2 → G-HalfClass    (photosHalf=2)
 *   ≤8 + full_class≥1 → G-FullClass    (photosFull=1)
 *   ≤8 без общих фото → null (правая страница не строится)
 *   9                 → G-Teachers-3x3 (teachers=9, min_fit)
 *   10-12             → G-Teachers-3x4 (teachers=subjects, min_fit) ✅ закрытие бага G-Teachers-4x3
 *   13-16             → G-Teachers-4x4 (teachers=subjects, min_fit)
 *   17+               → G-Teachers-4x4 (teachers=subjects-8, min_fit, offset=8)
 *
 * Закрытие скрытого бага: legacy-код искал 'G-Teachers-4x3' для 10-12,
 * в БД мастер 'G-Teachers-3x4'. Через семантический поиск ищем по
 * slot_capacity.teachers=10/11/12 и находим G-Teachers-3x4 (teachers=12)
 * как минимально-достаточный.
 */
function pickRightMaster(
  subjects: number,
  commonPhotos: RulesAlbumInput['common_photos'],
  ctx: SectionFillContext,
): RightChoice | null {
  // subjects ≤ 8: правая = общее фото
  if (subjects <= 8) {
    // Аква-меч: компактная правая сетка предметников (3x2), если есть в наборе.
    // Согласовано с pickLeftMaster (тот же findCompactSubjectRightGrid →
    // главный учитель один слева). Только при наличии мастера — иначе общее
    // фото (старый путь okeybook-default).
    const compact = findCompactSubjectRightGrid(ctx, subjects);
    if (compact) {
      return {
        master: compact,
        masterName: compact.name,
        subjectsCount: subjects,
        subjectsOffset: 0,
        consumes: {},
        semantic: true,
      };
    }
    if (commonPhotos.half_class.length >= 2) {
      const r = resolveTeacherMaster(
        ctx,
        'teacher_right',
        { teachers: 0, photosHalf: 2, match: 'exact' },
        'G-HalfClass',
      );
      if (!r) return null;
      return {
        master: r.master,
        masterName: r.master.name,
        subjectsCount: 0,
        subjectsOffset: 0,
        consumes: { half_class: 2 },
        semantic: r.semantic,
      };
    }
    if (commonPhotos.full_class.length >= 1) {
      const r = resolveTeacherMaster(
        ctx,
        'teacher_right',
        { teachers: 0, photosFull: 1, match: 'exact' },
        'G-FullClass',
      );
      if (!r) return null;
      return {
        master: r.master,
        masterName: r.master.name,
        subjectsCount: 0,
        subjectsOffset: 0,
        consumes: { full_class: 1 },
        semantic: r.semantic,
      };
    }
    // Ни half_class, ни full_class — правая страница не строится.
    ctx.warnings.push(
      `teachers_right_empty: нет общих фото для правой страницы (subjects=${subjects})`,
    );
    return null;
  }
  // 9: G-Teachers-3x3 (9 слотов)
  if (subjects === 9) {
    const r = resolveTeacherMaster(
      ctx,
      'teacher_right',
      { teachers: 9, match: 'min_fit' },
      'G-Teachers-3x3',
    );
    if (!r) return null;
    return {
      master: r.master,
      masterName: r.master.name,
      subjectsCount: 9,
      subjectsOffset: 0,
      consumes: {},
      semantic: r.semantic,
    };
  }
  // 10-12: G-Teachers-3x4 (12 слотов в БД, но legacy-код искал 'G-Teachers-4x3')
  if (subjects <= 12) {
    const r = resolveTeacherMaster(
      ctx,
      'teacher_right',
      { teachers: subjects, match: 'min_fit' },
      // Legacy fallback: имя из старого кода. После применения РЭ.22.7.1
      // семантический путь всегда найдёт мастер (G-Teachers-3x4 размечен),
      // но если template_set не размечен — legacy путь ищет несуществующее
      // имя 'G-Teachers-4x3' (баг). Указываем настоящее имя 'G-Teachers-3x4'
      // чтобы fallback работал в обоих случаях.
      'G-Teachers-3x4',
    );
    if (!r) return null;
    return {
      master: r.master,
      masterName: r.master.name,
      subjectsCount: subjects,
      subjectsOffset: 0,
      consumes: {},
      semantic: r.semantic,
    };
  }
  // 13-16: G-Teachers-4x4 (16 слотов)
  if (subjects <= 16) {
    const r = resolveTeacherMaster(
      ctx,
      'teacher_right',
      { teachers: subjects, match: 'min_fit' },
      'G-Teachers-4x4',
    );
    if (!r) return null;
    return {
      master: r.master,
      masterName: r.master.name,
      subjectsCount: subjects,
      subjectsOffset: 0,
      consumes: {},
      semantic: r.semantic,
    };
  }
  // 17+: остаток (до 16) на G-Teachers-4x4, начиная с offset=8
  const remaining = Math.min(16, subjects - 8);
  const r = resolveTeacherMaster(
    ctx,
    'teacher_right',
    { teachers: remaining, match: 'min_fit' },
    'G-Teachers-4x4',
  );
  if (!r) return null;
  return {
    master: r.master,
    masterName: r.master.name,
    subjectsCount: remaining,
    subjectsOffset: 8,
    consumes: {},
    semantic: r.semantic,
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
 *  - `headteachertext` / `…quote` / `headtextframe`  → text
 *  - `subjectphoto_N` / `subject_N` / `teacherphoto_N` → subjects[N-1].photo
 *  - `subjectname_N` / `teachername_N` → subjects[N-1].name
 *  - `subjectrole_N` / `teacherrole_N` → subjects[N-1].role
 */
export function bindLeftPage(
  master: SpreadTemplate,
  headTeacher: RulesHeadTeacherInput,
  subjects: RulesSubjectInput[],
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    const label = ph.label.toLowerCase();

    // ─ Главный учитель / воспитатель ─
    // Поддерживаем номер: headteacherphoto_N / headteachername_N / headteacherrole_N
    // (мастера детсада «Аква меч» именуют слоты с номером — два воспитателя).
    // Часть 1 (17.06): в данных пока ОДИН главный → слот _1 (или без номера)
    // заполняем, слоты _2+ скрываем (__hidden__). Часть 2 добавит массив из 2.
    const hpMatch = label.match(/^headteacherphoto(?:_(\d+))?$/);
    if (hpMatch) {
      const n = hpMatch[1] ? parseInt(hpMatch[1], 10) : 1;
      if (n === 1 && headTeacher.photo) {
        bindings[ph.label] = headTeacher.photo;
      } else {
        // Нет фото / второй воспитатель (пока не поддержан) → скрываем рамку,
        // чтобы Canvas/PDF не рисовал пустой прямоугольник.
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    const hnMatch = label.match(/^headteachername(?:_(\d+))?$/);
    if (hnMatch) {
      const n = hnMatch[1] ? parseInt(hnMatch[1], 10) : 1;
      if (n === 1) bindings[ph.label] = headTeacher.name;
      else bindings[`__hidden__${ph.label}`] = '1';
      continue;
    }
    const hrMatch = label.match(/^headteacherrole(?:_(\d+))?$/);
    if (hrMatch) {
      const n = hrMatch[1] ? parseInt(hrMatch[1], 10) : 1;
      if (n === 1) bindings[ph.label] = headTeacher.role;
      else bindings[`__hidden__${ph.label}`] = '1';
      continue;
    }
    if (label === 'headteachertext' || label === 'headteacherquote' || label === 'headtextframe') {
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
