/**
 * Заполнение секции type='students' для buildFromSectionStructure.
 *
 * Логика выбора режима — по `preset.density`, а для density=null
 * (Максимум / Индивидуальная) фолбэк через `preset.id`:
 *
 *   density / preset.id  | режим                          | мастера
 *   ─────────────────────┼────────────────────────────────┼────────────────────────────
 *   standard             | 1 ученик = 1 страница, alt L/R  | E-Standard-Left / E-Standard-Right
 *   universal            | 1 ученик = 1 страница, alt L/R  | E-Universal-Left / E-Universal-Right
 *   medium               | сетка 4 на страницу             | M-Grid-Page + M-Combined-Page
 *   light                | адаптивная сетка 6→4→3→2        | L-Grid-Page + L-N + L-Combined-Page
 *   mini                 | адаптивная сетка 12→9→6→4       | N-Grid-Page + N-N + N-Combined-Page
 *   null + id='maximum'  | 1 ученик = 1 разворот           | E-Max-Left + E-Max-Right  (РЭ.21.8.14)
 *   null + id='individual'| 1 ученик = 1 разворот (заглушка) | E-Max-Left + E-Max-Right  (РЭ.21.8.14)
 *                        | в РЭ.21.8.15 — адаптивный выбор |   мастера по friend_photos
 *   null + другой        | warning students_density_not_supported
 *
 * Примечание (РЭ.21.8.6a, после проверки на боевых данных): в template_set
 * okeybook-default density='standard' устроена так же как universal —
 * две одностраничные карточки с чередованием L/R. Раньше код ожидал
 * двухстраничный E-Student-Standard (is_spread), но такого мастера в БД
 * нет. Стандарт от Universal отличается только плотностью дизайна
 * (Universal содержит больше слотов для friend_photos). Поэтому код
 * для них общий через buildAlternatingLR.
 *
 * Bindings — placeholder-driven по аналогии с teachers (РЭ.21.8.4a).
 * Поддерживаемые labels:
 *  - studentportrait, studentname, studentquote
 *  - studentphoto_N / studentphotoN / friendphoto_N → friend_photos[N-1]
 *
 * Maximum / Individual комплектации имеют preset.density=null в БД
 * (см. РЭ.20.5 + рефлексию в master-cleanup-tz.md). Они обрабатываются
 * legacy buildAlbum, не новым engine'ом. Здесь для них warning
 * students_density_not_supported.
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';
import { findStudentMaster, findStudentGridMaster } from '../master-finder';
import type { RulesStudentInput } from '../types';
import { centerLastRowSlots, type SectionFillContext } from './shared';
import {
  decideDistribution,
  type DistributionMode,
  type DistributionPage,
} from './distribution';

export function fillStudentsSection(ctx: SectionFillContext): void {
  const preset = ctx.bundle.preset;

  // РЭ.22.4-22.6: приоритетные ветки для двух-осевой модели (см. spec §6.1).
  // Если у пресета задан `student_layout_mode` — engine идёт по
  // семантическому пути через findStudentMaster / findStudentGridMaster.
  // Когда поле NULL — fallback на legacy выбор по density / preset.id (ниже).
  if (preset.student_layout_mode === 'page') {
    buildPageSemantic(ctx);
    return;
  }
  if (preset.student_layout_mode === 'spread') {
    buildSpreadSemantic(ctx);
    return;
  }
  if (preset.student_layout_mode === 'grid') {
    buildGridSemantic(ctx);
    return;
  }

  const density = preset.density;

  // РЭ.21.8.14: фолбэк для density=null через preset.id. В БД у Максимум
  // и Индивидуальной комплектации density=null (РЭ.20.5). Section Structure
  // engine трактует preset.id='maximum' / 'individual' как маркер
  // соответствующего layout-режима. Это разовое решение Сергея 19.05.2026 —
  // когда появится отдельная колонка `category` в presets, эта логика
  // переходит туда.
  let effectiveDensity = density;
  if (!effectiveDensity) {
    if (ctx.bundle.preset.id === 'maximum') {
      // Один ученик = один разворот, мастера E-Max-Left + E-Max-Right.
      buildOnePerSpread(ctx, {
        kind: 'maximum',
        leftMasterName: 'E-Max-Left',
        rightMasterName: 'E-Max-Right',
      });
      return;
    }
    if (ctx.bundle.preset.id === 'individual') {
      // РЭ.21.8.15: семантический выбор мастера для каждого ученика.
      // Если у пресета заполнены поля student_pages_per_student=2 и
      // student_has_quote — engine ищет E-Individual-N (или другие
      // подходящие) мастера через findStudentMaster для каждого ученика
      // отдельно (у каждого своё количество friend_photos).
      // Иначе fallback на E-Max-Left/Right как у Maximum (заглушка
      // 21.8.14, сохраняет обратную совместимость).
      const useSemanticSearch =
        preset.student_pages_per_student === 2 &&
        typeof preset.student_has_quote === 'boolean';

      if (useSemanticSearch) {
        buildOnePerSpreadAdaptive(ctx);
      } else {
        buildOnePerSpread(ctx, {
          kind: 'individual',
          leftMasterName: 'E-Max-Left',
          rightMasterName: 'E-Max-Right',
        });
      }
      return;
    }
    ctx.warnings.push(
      `students_density_not_supported: preset.density is null и preset.id='${ctx.bundle.preset.id}' ` +
        `не поддерживается (ожидается 'maximum' или 'individual')`,
    );
    return;
  }

  switch (effectiveDensity) {
    case 'standard':
      buildAlternatingLR(ctx, {
        density: 'standard',
        leftMasterName: 'E-Standard-Left',
        rightMasterName: 'E-Standard-Right',
      });
      return;
    case 'universal':
      buildAlternatingLR(ctx, {
        density: 'universal',
        leftMasterName: 'E-Universal-Left',
        rightMasterName: 'E-Universal-Right',
      });
      return;
    case 'medium':
      buildGrid(ctx, {
        density: 'medium',
        baseMasterName: 'M-Grid-Page',
        defaultSlots: 4,
        adaptiveTailNames: [],
        combinedMasterName: 'M-Combined-Page',
      });
      return;
    case 'light':
      buildGrid(ctx, {
        density: 'light',
        baseMasterName: 'L-Grid-Page',
        defaultSlots: 6,
        adaptiveTailNames: ['L-2', 'L-3', 'L-4'],
        combinedMasterName: 'L-Combined-Page',
      });
      return;
    case 'mini':
      buildGrid(ctx, {
        density: 'mini',
        baseMasterName: 'N-Grid-Page',
        defaultSlots: 12,
        adaptiveTailNames: ['N-4', 'N-6', 'N-9'],
        combinedMasterName: 'N-Combined-Page',
      });
      return;
  }
}

// ─── Alternating L/R (standard, universal) ──────────────────────────────────

interface AlternatingLRConfig {
  density: 'standard' | 'universal';
  leftMasterName: string;
  rightMasterName: string;
}

/**
 * 1 ученик = 1 страница, чередование Left/Right мастеров по чётности
 * pageInstances.length. Используется для density='standard' и 'universal'
 * (в реальной БД оба режима устроены одинаково).
 */
function buildAlternatingLR(
  ctx: SectionFillContext,
  config: AlternatingLRConfig,
): void {
  const leftMaster = ctx.bundle.mastersByName.get(config.leftMasterName);
  const rightMaster = ctx.bundle.mastersByName.get(config.rightMasterName);

  if (!leftMaster) {
    ctx.warnings.push(
      `students_master_not_found: '${config.leftMasterName}' отсутствует в template_set дизайна`,
    );
    return;
  }
  if (!rightMaster) {
    ctx.warnings.push(
      `students_master_not_found: '${config.rightMasterName}' отсутствует в template_set дизайна`,
    );
    return;
  }

  const students = ctx.input.students;
  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const pageIndex = ctx.pageInstances.length;
    const position: 'left' | 'right' = pageIndex % 2 === 0 ? 'left' : 'right';
    const master = position === 'left' ? leftMaster : rightMaster;

    const bindings = bindSingleStudent(master, student);

    ctx.pageInstances.push({ master_id: master.id, bindings });

    ctx.decisionTrace.push({
      spread_index: Math.floor(pageIndex / 2),
      section_index: ctx.sectionIndex,
      family_id: 'student-section',
      rule_id: `${config.density}:${master.name}`,
      inputs: {
        density: config.density,
        student_index: i,
        student_name: student.full_name,
        position,
        friend_photos_count: student.friend_photos
          ? student.friend_photos.length
          : 0,
      },
    });
  }
}

// ─── Page semantic (РЭ.22.4) ────────────────────────────────────────────────

/**
 * РЭ.22.4: семантический выбор мастера для mode='page' (одна страница
 * на ученика, чередование L/R). Заменяет жёсткие имена E-Standard-Left/Right
 * и E-Universal-Left/Right на поиск через `findStudentMaster`.
 *
 * Активна только когда `preset.student_layout_mode === 'page'`. Для legacy
 * пресетов (mode=NULL) используется `buildAlternatingLR` со старыми
 * жёсткими именами — ничего не ломается.
 *
 * Алгоритм для каждого ученика:
 *  1. Определяем позицию (left/right) по чётности `ctx.pageInstances.length`.
 *     Это нужно чтобы корректно обрабатывать ситуации когда перед students
 *     прошла секция с нечётным числом страниц (например teachers одним F-*).
 *  2. Запрашиваем мастер через findStudentMaster:
 *       - pageRole = 'student_left' или 'student_right' соответственно
 *       - photosFriend = preset.student_friend_photos ?? 0
 *       - hasQuote = preset.student_has_quote ?? false
 *       - hasPortrait = true (для personal page портрет нужен всегда)
 *  3. Если мастер не найден — warning со спецификацией недостающих
 *     slot_capacity тегов, ученик пропускается (но остальные строятся).
 *  4. Если найден ближайший меньший по photos_friend — warning
 *     students_lost_photos (фото не помещаются в layout, но сохраняются
 *     в пуле партнёра).
 *
 * Bindings строятся через тот же `bindSingleStudent` что и для legacy —
 * placeholder-driven, поддерживает studentportrait/name/quote +
 * studentphoto_N / friendphoto_N для фото с друзьями.
 */
function buildPageSemantic(ctx: SectionFillContext): void {
  const preset = ctx.bundle.preset;
  const photosFriend = preset.student_friend_photos ?? 0;
  const hasQuote = preset.student_has_quote ?? false;
  const students = ctx.input.students;

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const pageIndex = ctx.pageInstances.length;
    const position: 'left' | 'right' = pageIndex % 2 === 0 ? 'left' : 'right';
    const pageRole: 'student_left' | 'student_right' =
      position === 'left' ? 'student_left' : 'student_right';

    const result = findStudentMaster(ctx.bundle.mastersByName, {
      presetId: preset.id,
      pageRole,
      photosFriend,
      hasQuote,
      hasPortrait: true,
    });

    if (!result) {
      ctx.warnings.push(
        `students_master_not_found: для пресета '${preset.id}' (mode=page) ` +
          `не найден мастер с page_role='${pageRole}', ` +
          `slot_capacity.students=1, photos_friend=${photosFriend}, ` +
          `has_quote=${hasQuote}, has_portrait=true. ` +
          `Закажите мастер у дизайнера.`,
      );
      continue;
    }

    const bindings = bindSingleStudent(result.master, student);
    ctx.pageInstances.push({
      master_id: result.master.id,
      bindings,
    });

    // Warning о потерянных фото, если мастер вместил меньше friend_photos.
    if (result.lostPhotos > 0) {
      ctx.warnings.push(
        `students_lost_photos: у ученика '${student.full_name}' было ${photosFriend} фото с друзьями, ` +
          `мастер '${result.master.name}' вмещает только ${photosFriend - result.lostPhotos}, ` +
          `${result.lostPhotos} фото не размещены в layout (фото сохранены в пуле партнёра)`,
      );
    }

    ctx.decisionTrace.push({
      spread_index: Math.floor(pageIndex / 2),
      section_index: ctx.sectionIndex,
      family_id: 'student-section',
      rule_id: `page_semantic:${result.master.name}`,
      inputs: {
        mode: 'page',
        student_index: i,
        student_name: student.full_name,
        position,
        page_role: pageRole,
        photos_friend_required: photosFriend,
        has_quote_required: hasQuote,
        master_name: result.master.name,
        exact_match: result.exactMatch,
        lost_photos: result.lostPhotos,
      },
    });
  }
}

// ─── Spread semantic (РЭ.22.5) ──────────────────────────────────────────────

/**
 * РЭ.22.5: семантический выбор мастера для mode='spread' (один ученик =
 * один разворот, 2 страницы). Заменяет жёстко прошитые E-Max-Left/Right
 * на семантический поиск через `findStudentMaster`.
 *
 * Активна только когда `preset.student_layout_mode === 'spread'`.
 *
 * FIXED модель: один и тот же мастер используется для ВСЕХ учеников (по
 * `preset.student_friend_photos`). Это отличается от per-student адаптивной
 * модели `buildOnePerSpreadAdaptive` (РЭ.21.8.15), которая для Individual
 * выбирает мастер под количество фактических фото КАЖДОГО ученика отдельно.
 *
 * ⚠️ Побочный эффект: если в UI переключить Individual-пресет на
 * student_layout_mode='spread' (и сохранить) — он потеряет per-student
 * адаптивность. Чтобы её сохранить, Individual должен оставаться в
 * legacy-пути (mode=NULL + preset.id='individual'). UI РЭ.22.3
 * computeInitialLayoutMode возвращает 'spread' для Individual в initial
 * state, но в БД пишет только после явного нажатия Save — до тех пор
 * Individual работает как раньше.
 *
 * Алгоритм для каждого ученика (2 страницы):
 *  1. Левая страница (портрет + имя): findStudentMaster с
 *     pageRole='student_left', photosFriend=0, hasPortrait=true.
 *  2. Правая страница (фото с друзьями + опц. quote): findStudentMaster с
 *     pageRole='student_right', photosFriend=preset.student_friend_photos,
 *     hasQuote=preset.student_has_quote.
 *  3. Если любой не найден — warning, ученик пропускается (но остальные
 *     строятся).
 *  4. Если правый найден ближайший меньший по photos_friend — warning
 *     students_lost_photos.
 */
function buildSpreadSemantic(ctx: SectionFillContext): void {
  const preset = ctx.bundle.preset;
  const photosFriendRequired = preset.student_friend_photos ?? 0;
  const hasQuote = preset.student_has_quote ?? false;
  const students = ctx.input.students;

  for (let i = 0; i < students.length; i++) {
    const student = students[i];

    // Левая страница: портрет ученика, без фото и без quote.
    const leftResult = findStudentMaster(ctx.bundle.mastersByName, {
      presetId: preset.id,
      pageRole: 'student_left',
      photosFriend: 0,
      hasPortrait: true,
    });

    // Правая страница: фото с друзьями (количество фиксировано через пресет).
    const rightResult = findStudentMaster(ctx.bundle.mastersByName, {
      presetId: preset.id,
      pageRole: 'student_right',
      photosFriend: photosFriendRequired,
      hasQuote: hasQuote,
    });

    if (!leftResult || !rightResult) {
      const missing: string[] = [];
      if (!leftResult) {
        missing.push("page_role='student_left', photos_friend=0, has_portrait=true");
      }
      if (!rightResult) {
        missing.push(
          `page_role='student_right', photos_friend=${photosFriendRequired}, has_quote=${hasQuote}`,
        );
      }
      ctx.warnings.push(
        `students_master_not_found: для пресета '${preset.id}' (mode=spread) ` +
          `для ученика '${student.full_name}' не найдены мастера: ${missing.join('; ')}. ` +
          `Закажите мастер у дизайнера.`,
      );
      continue;
    }

    const leftBindings = bindSingleStudent(leftResult.master, student);
    const rightBindings = bindSingleStudent(rightResult.master, student);

    ctx.pageInstances.push({
      master_id: leftResult.master.id,
      bindings: leftBindings,
    });
    ctx.pageInstances.push({
      master_id: rightResult.master.id,
      bindings: rightBindings,
    });

    // Warning о потерянных фото, если правый мастер вместил меньше.
    if (rightResult.lostPhotos > 0) {
      ctx.warnings.push(
        `students_lost_photos: у ученика '${student.full_name}' пресет требует ` +
          `${photosFriendRequired} фото с друзьями, мастер '${rightResult.master.name}' ` +
          `вмещает только ${photosFriendRequired - rightResult.lostPhotos}, ` +
          `${rightResult.lostPhotos} фото не размещены в layout ` +
          `(фото сохранены в пуле партнёра)`,
      );
    }

    ctx.decisionTrace.push({
      spread_index: Math.floor((ctx.pageInstances.length - 2) / 2),
      section_index: ctx.sectionIndex,
      family_id: 'student-section',
      rule_id: `spread_semantic:${leftResult.master.name}+${rightResult.master.name}`,
      inputs: {
        mode: 'spread',
        student_index: i,
        student_name: student.full_name,
        photos_friend_required: photosFriendRequired,
        has_quote_required: hasQuote,
        left_master: leftResult.master.name,
        right_master: rightResult.master.name,
        right_exact_match: rightResult.exactMatch,
        right_lost_photos: rightResult.lostPhotos,
      },
    });
  }
}

// ─── One-per-spread (Maximum, Individual) ──────────────────────────────────

interface OnePerSpreadConfig {
  kind: 'maximum' | 'individual';
  leftMasterName: string;
  rightMasterName: string;
}

/**
 * Один ученик = один разворот. Используется для Максимум и (временно)
 * Индивидуальной комплектации.
 *
 * Левая страница: портрет + имя (мастер leftMasterName, обычно E-Max-Left).
 * Правая страница: фото с друзьями + текст-цитата (мастер rightMasterName,
 * обычно E-Max-Right).
 *
 * Bindings обоих сторон строятся через bindSingleStudent (один ученик —
 * placeholder-driven, поддерживает portrait/name/quote + friend_photos
 * подставляющиеся в studentphoto_N / friendphoto_N слоты).
 *
 * РЭ.21.8.15 заменит этот метод для kind='individual' на адаптивный выбор
 * мастера по количеству friend_photos.
 */
function buildOnePerSpread(
  ctx: SectionFillContext,
  config: OnePerSpreadConfig,
): void {
  const leftMaster = ctx.bundle.mastersByName.get(config.leftMasterName);
  const rightMaster = ctx.bundle.mastersByName.get(config.rightMasterName);

  if (!leftMaster) {
    ctx.warnings.push(
      `students_master_not_found: '${config.leftMasterName}' отсутствует в template_set дизайна`,
    );
    return;
  }
  if (!rightMaster) {
    ctx.warnings.push(
      `students_master_not_found: '${config.rightMasterName}' отсутствует в template_set дизайна`,
    );
    return;
  }

  const students = ctx.input.students;
  for (let i = 0; i < students.length; i++) {
    const student = students[i];

    // Left + right bindings строим отдельно — на каждой странице свои
    // placeholder labels (portrait слева, friend_photos справа). Логика
    // placeholder-driven та же что в одностраничных мастерах.
    const leftBindings = bindSingleStudent(leftMaster, student);
    const rightBindings = bindSingleStudent(rightMaster, student);

    ctx.pageInstances.push({
      master_id: leftMaster.id,
      bindings: leftBindings,
    });
    ctx.pageInstances.push({
      master_id: rightMaster.id,
      bindings: rightBindings,
    });

    ctx.decisionTrace.push({
      spread_index: Math.floor((ctx.pageInstances.length - 2) / 2),
      section_index: ctx.sectionIndex,
      family_id: 'student-section',
      rule_id: `${config.kind}:E-Max-spread`,
      inputs: {
        density: config.kind,
        student_index: i,
        student_name: student.full_name,
        friend_photos_count: student.friend_photos
          ? student.friend_photos.length
          : 0,
      },
    });
  }
}

/**
 * Адаптивный one-per-spread (РЭ.21.8.15): мастер выбирается отдельно
 * для каждого ученика по количеству его friend_photos.
 *
 * Используется когда у пресета заполнены поля:
 *   - student_pages_per_student=2 (двухстраничный режим)
 *   - student_has_quote (булево)
 *
 * Алгоритм для каждого ученика:
 *   1. Левая страница — findStudentMaster(pageRole='student_left',
 *      photosFriend=0, hasPortrait=true). У E-Max-Left photos_friend=0
 *      (фото только справа).
 *   2. Правая страница — findStudentMaster(pageRole='student_right',
 *      photosFriend=student.friend_photos.length, hasQuote=preset.has_quote).
 *      Engine найдёт E-Individual-N с подходящим числом слотов или ближайший
 *      меньший.
 *   3. Если у ученика 5 фото, а мастер на 4 — engine помещает 4, 1 фото
 *      теряется + warning students_lost_photos с указанием на partнера.
 *
 * Если для какого-то ученика мастер не найден вообще — warning + ученик
 * пропускается (остальные продолжают строиться).
 */
function buildOnePerSpreadAdaptive(ctx: SectionFillContext): void {
  const preset = ctx.bundle.preset;
  const hasQuote = preset.student_has_quote ?? false;
  const students = ctx.input.students;

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const friendCount = student.friend_photos
      ? student.friend_photos.length
      : 0;

    // Левая страница: портрет ученика, без фото с друзьями.
    const leftResult = findStudentMaster(ctx.bundle.mastersByName, {
      presetId: preset.id,
      pageRole: 'student_left',
      photosFriend: 0,
      hasPortrait: true,
    });

    // Правая страница: фото с друзьями.
    const rightResult = findStudentMaster(ctx.bundle.mastersByName, {
      presetId: preset.id,
      pageRole: 'student_right',
      photosFriend: friendCount,
      hasQuote: hasQuote,
    });

    if (!leftResult || !rightResult) {
      const missing: string[] = [];
      if (!leftResult) missing.push('left (page_role=student_left)');
      if (!rightResult) missing.push(`right (page_role=student_right, friend_photos=${friendCount})`);
      ctx.warnings.push(
        `students_master_not_found: для ученика '${student.full_name}' ` +
          `не найдены мастера: ${missing.join(', ')}`,
      );
      continue;
    }

    // Bindings обеих сторон.
    const leftBindings = bindSingleStudent(leftResult.master, student);
    const rightBindings = bindSingleStudent(rightResult.master, student);

    ctx.pageInstances.push({
      master_id: leftResult.master.id,
      bindings: leftBindings,
    });
    ctx.pageInstances.push({
      master_id: rightResult.master.id,
      bindings: rightBindings,
    });

    // Warning о потерянных фото, если правый мастер вместил меньше.
    if (rightResult.lostPhotos > 0) {
      ctx.warnings.push(
        `students_lost_photos: у ученика '${student.full_name}' было ${friendCount} фото с друзьями, ` +
          `мастер '${rightResult.master.name}' вмещает только ${friendCount - rightResult.lostPhotos}, ` +
          `${rightResult.lostPhotos} фото не размещены в layout (фото сохранены в пуле партнёра)`,
      );
    }

    ctx.decisionTrace.push({
      spread_index: Math.floor((ctx.pageInstances.length - 2) / 2),
      section_index: ctx.sectionIndex,
      family_id: 'student-section',
      rule_id: `adaptive:${leftResult.master.name}+${rightResult.master.name}`,
      inputs: {
        density: 'individual',
        student_index: i,
        student_name: student.full_name,
        friend_photos_count: friendCount,
        left_master: leftResult.master.name,
        right_master: rightResult.master.name,
        right_exact_match: rightResult.exactMatch,
        right_lost_photos: rightResult.lostPhotos,
      },
    });
  }
}

// ─── Bindings одностраничного ученика ──────────────────────────────────────

/**
 * Bindings для одностраничного мастера ученика (E-Standard-* / E-Universal-*).
 *
 * Поддерживаемые labels:
 *   studentportrait        → student.portrait
 *   studentname            → student.full_name
 *   studentquote           → student.quote
 *   studentphoto_N / studentphotoN / friendphoto_N → student.friend_photos[N-1]
 */
function bindSingleStudent(
  master: SpreadTemplate,
  student: RulesStudentInput,
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  const friends = student.friend_photos ?? [];

  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    const label = ph.label.toLowerCase();

    if (label === 'studentportrait') {
      bindings[ph.label] = student.portrait;
      continue;
    }
    if (label === 'studentname') {
      bindings[ph.label] = student.full_name;
      continue;
    }
    if (label === 'studentquote') {
      bindings[ph.label] = student.quote ?? null;
      continue;
    }

    const friendMatch = label.match(/^(?:studentphoto|friendphoto)_?(\d+)$/);
    if (friendMatch) {
      const n = parseInt(friendMatch[1], 10);
      bindings[ph.label] = friends[n - 1] ?? null;
      continue;
    }
  }
  return bindings;
}

// ─── Grid semantic (РЭ.22.6) ─────────────────────────────────────────────

/**
 * РЭ.22.6: семантический выбор мастера для mode='grid'. Заменяет жёсткие
 * имена M/L/N-Grid-Page и адаптивный список L-2/3/4 / N-4/6/9 на
 * семантический поиск через `findStudentGridMaster` (page_role='student_grid*',
 * slot_capacity.students=N).
 *
 * Активна только когда `preset.student_layout_mode === 'grid'`. Для legacy
 * пресетов (mode=NULL) используется `buildGrid` со старыми жёсткими именами.
 *
 * Алгоритм (повторяет логику buildGrid, но через семантический поиск):
 *  1. Base-мастер: точное совпадение по students=preset.student_grid_size,
 *     photos_full=0 (обычная сетка без общего фото).
 *  2. Полные страницы заполняются base-мастером.
 *  3. Хвост (remainder = total % gridSize):
 *     a. Combined-tail: если available.full_class >= 1 — ищем мастер с
 *        photos_full=1, students>=remainder (min_fit). Если найден,
 *        используем + декремент full_class.
 *     b. Adaptive tail: ищем мастер с photos_full=0, students>=remainder.
 *        Эта ветка покрывает случаи когда в template_set есть мастера
 *        размером меньше base-сетки (L-2/L-3/L-4 для Light).
 *     c. Fallback: base-мастер с null-заполнением (последние слоты null).
 *        Warning students_grid_tail_padded.
 *
 * Если base-мастер не найден — warning + секция не строится.
 * Если grid_size не задан в пресете — warning + секция не строится.
 */
function buildGridSemantic(ctx: SectionFillContext): void {
  const preset = ctx.bundle.preset;
  const gridSize = preset.student_grid_size;
  const hasQuote = preset.student_has_quote ?? false;

  if (gridSize === null || gridSize === undefined) {
    ctx.warnings.push(
      `students_grid_size_missing: для пресета '${preset.id}' (mode=grid) ` +
        `не задан student_grid_size. Заполните в /super/presets и сохраните.`,
    );
    return;
  }

  const students = ctx.input.students;
  if (students.length === 0) return;

  // 1. Base-мастер для полных страниц: точное совпадение students=gridSize,
  //    без общего фото (photos_full=0).
  let baseResult = findStudentGridMaster(ctx.bundle.mastersByName, {
    presetId: preset.id,
    pageRole: null, // принимаем любую grid-роль
    studentsCount: gridSize,
    match: 'exact',
    photosFull: 0,
    hasQuote: hasQuote,
    hasPortrait: true,
  });

  // РЭ.37.9 (25.05.2026): fallback на hasQuote=false если партнёр включил
  // цитаты, но в template_set нет мастера-сетки с цитатами. Лучше построить
  // альбом без цитат, чем не построить вовсе. Info-warning объяснит партнёру
  // что произошло и как починить.
  //
  // effectiveHasQuote — реальное значение которое будет использовано всеми
  // последующими find-вызовами (combined-tail, adaptive). Если fallback
  // сработал, все хвостовые мастера тоже ищутся без quote — иначе combo
  // на хвосте откажется (он использует тот же hasQuote критерий).
  let effectiveHasQuote = hasQuote;
  if (!baseResult && hasQuote) {
    baseResult = findStudentGridMaster(ctx.bundle.mastersByName, {
      presetId: preset.id,
      pageRole: null,
      studentsCount: gridSize,
      match: 'exact',
      photosFull: 0,
      hasQuote: false,
      hasPortrait: true,
    });
    if (baseResult) {
      effectiveHasQuote = false;
      ctx.warnings.push(
        `students_quote_fallback: в дизайне нет мастера-сетки на ` +
          `${gridSize} учеников с цитатами под каждым — взят мастер ` +
          `без цитат («${baseResult.master.name}»). Цитаты учеников не ` +
          `показаны. Чтобы вернуть цитаты, выберите другой дизайн ` +
          `шаблона или закажите кастомный мастер у дизайнера.`,
      );
      ctx.decisionTrace.push({
        spread_index: Math.floor(ctx.pageInstances.length / 2),
        section_index: ctx.sectionIndex,
        family_id: 'student-section',
        rule_id: `grid_semantic:quote_fallback:${baseResult.master.name}`,
        inputs: {
          requested_has_quote: true,
          actual_has_quote: false,
          grid_size: gridSize,
          master_name: baseResult.master.name,
        },
      });
    }
  }

  if (!baseResult) {
    ctx.warnings.push(
      `students_master_not_found: для пресета '${preset.id}' (mode=grid) ` +
        `не найден base-мастер с page_role='student_grid*', ` +
        `slot_capacity.students=${gridSize}, photos_full=0, ` +
        `has_quote=${hasQuote} или has_quote=false. ` +
        `Закажите мастер у дизайнера или выберите другой дизайн шаблона.`,
    );
    return;
  }

  const baseMaster = baseResult.master;
  const slotsPerPage = gridSize;

  const total = students.length;
  if (total === 0) return;

  // РЭ.40: пред-поиск combined-мастера для алгоритма decideDistribution.
  // Combined-мастер ищется ОДИН раз (по photos_full=1) с любым students
  // ≤ slotsPerPage; capacity берём из найденного. Если мастера нет —
  // combinedCapacity=null и алгоритм не будет пытаться combined-tail.
  //
  // Поиск через min_fit=null или конкретный? Используем match='min_fit'
  // с students=1 — найдёт минимальный combined с photos_full=1 (если он
  // есть в template_set). Capacity — из slot_capacity.students этого
  // мастера.
  let combinedMaster: SpreadTemplate | null = null;
  let combinedCapacity: number | null = null;
  const allMasters = Array.from(ctx.bundle.mastersByName.values());
  for (const m of allMasters) {
    if (!m.slot_capacity) continue;
    const photosFullN =
      typeof m.slot_capacity.photos_full === 'number' ? m.slot_capacity.photos_full : 0;
    const studentsN =
      typeof m.slot_capacity.students === 'number' ? m.slot_capacity.students : 0;
    if (photosFullN === 1 && studentsN >= 1 && studentsN < slotsPerPage) {
      // Берём максимальный по студентам combined (например N-Combined-Page
      // на 4 студентов, а не на 2). Алгоритм decideDistribution сам выберет
      // правильный X из 1..capacity.
      if (combinedCapacity === null || studentsN > combinedCapacity) {
        combinedMaster = m;
        combinedCapacity = studentsN;
      }
    }
  }

  // РЭ.40: режим распределения из albums.student_distribution.
  const mode: DistributionMode = ctx.input.student_distribution ?? 'auto';

  const decision = decideDistribution({
    N: total,
    maxGrid: slotsPerPage,
    combinedCapacity,
    hasClassPhoto: ctx.available.full_class >= 1,
    mode,
  });

  // Распределяем учеников по страницам в порядке решения алгоритма.
  let studentCursor = 0;
  for (let pageIdx = 0; pageIdx < decision.pages.length; pageIdx++) {
    const page = decision.pages[pageIdx];
    const slice = students.slice(studentCursor, studentCursor + page.count);
    studentCursor += page.count;

    if (page.type === 'combined' && combinedMaster) {
      const combSlotsTotal =
        combinedMaster.slot_capacity &&
        typeof combinedMaster.slot_capacity.students === 'number'
          ? combinedMaster.slot_capacity.students
          : page.count;
      pushCombinedTailPage(
        ctx,
        combinedMaster,
        slice,
        combSlotsTotal,
        // density: семантический путь не имеет density, передаём 'semantic'.
        'semantic' as unknown as GridConfig['density'],
      );
    } else {
      // type='grid' — кладём в base-мастер (slotsPerPage = gridSize).
      // Если count < slotsPerPage, неиспользованные слоты будут null,
      // centerLastRowSlots внутри pushGridPage сделает центрирование.
      pushGridPage(
        ctx,
        baseMaster,
        slice,
        slotsPerPage,
        `grid_semantic:${mode}:${pageIdx}`,
      );
    }
  }
}

// ─── Grid режимы (Medium / Light / Mini) ───────────────────────────────────

/**
 * Конфиг для одного grid-режима. Имена мастеров — это семантические
 * имена, которые предполагает inventory §4. Реальное наличие в
 * template_set okeybook-default проверим в РЭ.21.8.6 на боевых данных.
 *
 *  - `baseMasterName` — основной сеточный мастер (M/L/N-Grid-Page),
 *    содержит `defaultSlots` ученических placeholder'ов.
 *  - `defaultSlots` — fallback количество слотов, если у мастера нет
 *    `slot_capacity.students`. Используется только если БД-тег не задан.
 *  - `adaptiveTailNames` — упорядоченный (asc по slots) список адаптивных
 *    мастеров для хвоста. Пустой массив для Medium (нет адаптивных).
 *    Для Light: L-2 / L-3 / L-4. Для Mini: N-4 / N-6 / N-9. Берётся
 *    минимально-достаточный по slot_capacity.students (см. pickAdaptiveTail).
 *  - `combinedMasterName` — мастер с N учениками сверху + общее фото снизу,
 *    используется для хвоста когда есть `full_class >= 1`. Потребляет
 *    1 фото full_class.
 */
interface GridConfig {
  density: 'medium' | 'light' | 'mini';
  baseMasterName: string;
  defaultSlots: number;
  adaptiveTailNames: string[];
  combinedMasterName: string;
}

function buildGrid(ctx: SectionFillContext, config: GridConfig): void {
  const baseMaster = ctx.bundle.mastersByName.get(config.baseMasterName);
  if (!baseMaster) {
    ctx.warnings.push(
      `students_master_not_found: '${config.baseMasterName}' отсутствует в template_set дизайна`,
    );
    return;
  }

  const slotsPerPage =
    baseMaster.slot_capacity && typeof baseMaster.slot_capacity.students === 'number'
      ? baseMaster.slot_capacity.students
      : config.defaultSlots;
  if (slotsPerPage < 1) {
    ctx.warnings.push(
      `students_grid_invalid_slots: '${config.baseMasterName}' has slot_capacity.students < 1`,
    );
    return;
  }

  const students = ctx.input.students;
  const total = students.length;
  if (total === 0) return;

  // РЭ.40: определяем combined-мастера и его capacity для алгоритма.
  // Если мастера в template_set нет — combinedCapacity=null, algorithm
  // не будет пытаться combined-tail.
  const combinedMaster = ctx.bundle.mastersByName.get(config.combinedMasterName);
  const combinedCapacity =
    combinedMaster &&
    combinedMaster.slot_capacity &&
    typeof combinedMaster.slot_capacity.students === 'number'
      ? combinedMaster.slot_capacity.students
      : null;

  // РЭ.40: режим распределения берём из albums.student_distribution.
  // Если поле undefined (старый альбом до миграции) — применяем 'auto'.
  const mode: DistributionMode = ctx.input.student_distribution ?? 'auto';

  const decision = decideDistribution({
    N: total,
    maxGrid: slotsPerPage,
    combinedCapacity,
    hasClassPhoto: ctx.available.full_class >= 1,
    mode,
  });

  // Распределяем учеников по страницам в порядке решения алгоритма.
  let studentCursor = 0;
  for (let pageIdx = 0; pageIdx < decision.pages.length; pageIdx++) {
    const page = decision.pages[pageIdx];
    const slice = students.slice(studentCursor, studentCursor + page.count);
    studentCursor += page.count;

    if (page.type === 'combined' && combinedMaster) {
      const combSlots =
        combinedMaster.slot_capacity &&
        typeof combinedMaster.slot_capacity.students === 'number'
          ? combinedMaster.slot_capacity.students
          : page.count;
      pushCombinedTailPage(ctx, combinedMaster, slice, combSlots, config.density);
    } else {
      // type='grid' — кладём в baseMaster.
      pushGridPage(
        ctx,
        baseMaster,
        slice,
        slotsPerPage,
        `${config.density}:grid:${pageIdx}:${mode}`,
      );
    }
  }
}

/**
 * Выбирает минимально-достаточного адаптивного мастера для остатка.
 *
 * Параметры:
 *  - `names` — кандидаты в порядке возрастания slots (например ['L-2','L-3','L-4']).
 *  - `remainder` — количество учеников в хвосте.
 *
 * Алгоритм: собираем кандидатов с известным slot count, фильтруем по
 * `slots >= remainder`, берём минимальный по slots. Slot count берётся
 * из `master.slot_capacity.students` или парсится из имени (`L-N` → N).
 * Если ни один кандидат не подходит — null (caller сделает другой fallback).
 */
/**
 * РЭ.40: legacy-функции pickAdaptiveTail и slotsFromName удалены —
 * новый алгоритм decideDistribution() более общий и не использует
 * именования вида L-N / N-N для поиска адаптивного мастера.
 * Алгоритм работает только с base + combined мастерами.
 *
 * adaptiveTailNames в GridConfig остаются (для обратной совместимости
 * с типом), но игнорируются. Удалить в будущем коммите.
 */

/**
 * Положить grid-страницу: формирует bindings (studentportrait_N + name + quote),
 * добавляет PageInstance и decision_trace.
 */
/**
 * Положить grid-страницу: bindings grid (с __hidden__ для пустых слотов),
 * без classphotoframe. Используется как для основной students-логики,
 * так и для симметризации хвоста из transition.ts (РЭ.37.4).
 */
export function pushGridPage(
  ctx: SectionFillContext,
  master: SpreadTemplate,
  students: RulesStudentInput[],
  slotsPerPage: number,
  ruleId: string,
): void {
  const bindings = bindGridStudents(master, students, slotsPerPage);
  ctx.pageInstances.push({ master_id: master.id, bindings });
  const pageIndex = ctx.pageInstances.length - 1;
  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'student-section',
    rule_id: ruleId,
    inputs: {
      master_name: master.name,
      students_on_page: students.length,
      slots_per_page: slotsPerPage,
      page_position: pageIndex % 2 === 0 ? 'left' : 'right',
    },
  });
}

/**
 * Положить combined-tail страницу: bindings grid + classphotoframe (общее фото),
 * декремент ctx.available.full_class. Порядок важен: bindings ДО decrement,
 * чтобы used-index был корректным.
 *
 * РЭ.37.2.b: экспортирована для переиспользования из sections/transition.ts —
 * combo-мастера в переходном разделе используют ту же логику (grid +
 * classphoto + __hidden__ для лишних слотов). Поведение функции не
 * изменилось, только видимость.
 */
export function pushCombinedTailPage(
  ctx: SectionFillContext,
  master: SpreadTemplate,
  students: RulesStudentInput[],
  slotsPerPage: number,
  density: GridConfig['density'],
): void {
  // Сначала grid-bindings (без classphotoframe — он добавляется ниже).
  const bindings = bindGridStudents(master, students, slotsPerPage);

  // classphotoframe — берём первое ещё не потреблённое фото full_class.
  const fullClassUsed =
    ctx.input.common_photos.full_class.length - ctx.available.full_class;
  const fullClassPhoto = ctx.input.common_photos.full_class[fullClassUsed];
  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    if (ph.label.toLowerCase() === 'classphotoframe') {
      if (fullClassPhoto) bindings[ph.label] = fullClassPhoto;
      break;
    }
  }

  // Потребление — ПОСЛЕ bindings (см. doc-комментарий функции).
  ctx.available.full_class -= 1;

  ctx.pageInstances.push({ master_id: master.id, bindings });
  const pageIndex = ctx.pageInstances.length - 1;
  ctx.decisionTrace.push({
    spread_index: Math.floor(pageIndex / 2),
    section_index: ctx.sectionIndex,
    family_id: 'student-section',
    rule_id: `${density}:combined_tail:${master.name}`,
    inputs: {
      master_name: master.name,
      students_on_page: students.length,
      slots_per_page: slotsPerPage,
      consumes: { full_class: 1 },
    },
  });
}

/**
 * Bindings для grid-мастера (M/L/N-Grid-Page и адаптивных L-N / N-N).
 *
 * Поддерживаемые labels (placeholder-driven):
 *   studentportrait_N → students[N-1].portrait
 *   studentname_N     → students[N-1].full_name
 *   studentquote_N    → students[N-1].quote
 *
 * РЭ.31.3: для слотов с индексом > students.length теперь пишется
 * __hidden__<label>='1' вместо null. Раньше docstring обещал «Konva
 * canvas скроет через __hidden__N логику», но эта логика никогда не
 * писала __hidden__ — placeholder'ы оставались видимыми с пустотой.
 * Теперь combined-tail страница (хвост 1 ученика в 2-слотном мастере)
 * корректно показывает только Фёдорову Варвару без пустой колонки.
 *
 * classphotoframe (для combined-pages) обрабатывается в pushCombinedTailPage,
 * не здесь.
 */
function bindGridStudents(
  master: SpreadTemplate,
  students: RulesStudentInput[],
  _slotsPerPage: number,
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  for (let i = 0; i < master.placeholders.length; i++) {
    const ph = master.placeholders[i];
    const label = ph.label.toLowerCase();

    const portraitMatch = label.match(/^studentportrait_(\d+)$/);
    if (portraitMatch) {
      const n = parseInt(portraitMatch[1], 10);
      const s = students[n - 1];
      if (s) {
        bindings[ph.label] = s.portrait;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    const nameMatch = label.match(/^studentname_(\d+)$/);
    if (nameMatch) {
      const n = parseInt(nameMatch[1], 10);
      const s = students[n - 1];
      if (s) {
        bindings[ph.label] = s.full_name;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
    const quoteMatch = label.match(/^studentquote_(\d+)$/);
    if (quoteMatch) {
      const n = parseInt(quoteMatch[1], 10)
      const s = students[n - 1];
      if (s) {
        bindings[ph.label] = s.quote ?? null;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
      continue;
    }
  }
  // РЭ.37.5.b (25.05.2026): если часть слотов в ряду скрыта через
  // __hidden__ (адаптивный хвост сетки или симметризованная страница
  // из РЭ.37.4), центрируем оставшиеся видимые в этом ряду через
  // __pos__<label>. Для полных страниц (без __hidden__) — no-op.
  centerLastRowSlots(master, bindings);
  return bindings;
}
