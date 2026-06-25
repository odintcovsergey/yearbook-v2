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
import type { RulesStudentInput, StudentsSectionConfig } from '../types';
import { centerLastRowSlots, type SectionFillContext } from './shared';
import {
  decideDistribution,
  type DistributionMode,
} from './distribution';

/** Нормализованный режим личного раздела (после сворачивания config/глобалок). */
type ResolvedStudents =
  | { mode: 'page'; friends: number; quote: boolean; isPersonal: boolean }
  | {
      mode: 'spread';
      friendsMin: number;
      friendsMax: number;
      quote: boolean;
      isPersonal: boolean;
    }
  | { mode: 'grid'; perPage: number | null | undefined; quote: boolean }
  | {
      mode: 'multi_spread';
      spreadsPerStudent: number;
      quote: boolean;
      manualPages: string[] | null;
      isPersonal: boolean;
    }
  | { mode: 'legacy' };

/**
 * Метка личной страницы (ТЗ 19.06.2026 «персональный раздел»). Возвращает
 * объект `{ personal }` для spread'а в PageInstance, либо `undefined` (секция
 * общая) — тогда `...personalTag(...)` ничего не добавляет. По этой метке
 * lib/album-split разносит развороты по книгам ученика.
 */
function personalTag(
  ctx: SectionFillContext,
  isPersonal: boolean,
  studentIndex: number,
): { personal: { section_index: number; student_index: number } } | undefined {
  return isPersonal
    ? { personal: { section_index: ctx.sectionIndex, student_index: studentIndex } }
    : undefined;
}

/**
 * Сворачивает настройки личного раздела в единый вид. Приоритет:
 *  1. `config` секции (ТЗ 17.06.2026) — per-section настройки.
 *  2. Глобальные поля пресета `student_layout_mode` (legacy-фолбэк РЭ.22.1):
 *     spread сворачивается в диапазон min=max=student_friend_photos.
 *  3. Иначе `legacy` — выбор по density / preset.id (ниже в fillStudentsSection).
 *
 * Цитата для grid читается из глобального поля пресета (в config grid её нет —
 * см. StudentsSectionConfig), чтобы не регрессировать существующие grid-пресеты.
 */
function resolveStudentsConfig(
  preset: SectionFillContext['bundle']['preset'],
  config: StudentsSectionConfig | undefined,
): ResolvedStudents {
  if (config) {
    switch (config.mode) {
      case 'page':
        return {
          mode: 'page',
          friends: config.friends,
          quote: config.quote,
          isPersonal: config.is_personal ?? false,
        };
      case 'spread':
        return {
          mode: 'spread',
          friendsMin: config.friends_min,
          friendsMax: config.friends_max,
          quote: config.quote,
          isPersonal: config.is_personal ?? false,
        };
      case 'grid':
        return {
          mode: 'grid',
          perPage: config.per_page,
          quote: preset.student_has_quote ?? false,
        };
      case 'multi_spread':
        return {
          mode: 'multi_spread',
          spreadsPerStudent: config.spreads_per_student,
          quote: config.quote,
          manualPages:
            config.manual_pages && config.manual_pages.length > 0
              ? config.manual_pages
              : null,
          isPersonal: config.is_personal ?? false,
        };
    }
  }

  // Legacy-фолбэк на глобальные поля пресета (РЭ.22.1). is_personal —
  // только для per-section config; legacy-путь всегда общий (isPersonal=false).
  const friends = preset.student_friend_photos ?? 0;
  const quote = preset.student_has_quote ?? false;
  if (preset.student_layout_mode === 'page') {
    return { mode: 'page', friends, quote, isPersonal: false };
  }
  if (preset.student_layout_mode === 'spread') {
    return { mode: 'spread', friendsMin: friends, friendsMax: friends, quote, isPersonal: false };
  }
  if (preset.student_layout_mode === 'grid') {
    return { mode: 'grid', perPage: preset.student_grid_size, quote };
  }
  return { mode: 'legacy' };
}

export function fillStudentsSection(
  ctx: SectionFillContext,
  config?: StudentsSectionConfig,
): void {
  const preset = ctx.bundle.preset;

  // ТЗ 17.06.2026: настройки личного раздела привязаны к секции (config).
  // resolveStudentsConfig сворачивает config или (фолбэк) глобальные поля
  // пресета. mode='legacy' → старый путь по density / preset.id (ниже).
  const resolved = resolveStudentsConfig(preset, config);
  if (resolved.mode === 'page') {
    buildPageSemantic(ctx, {
      friends: resolved.friends,
      hasQuote: resolved.quote,
      isPersonal: resolved.isPersonal,
    });
    return;
  }
  if (resolved.mode === 'spread') {
    buildSpreadSemantic(ctx, {
      friendsMin: resolved.friendsMin,
      friendsMax: resolved.friendsMax,
      hasQuote: resolved.quote,
      isPersonal: resolved.isPersonal,
    });
    return;
  }
  if (resolved.mode === 'grid') {
    buildGridSemantic(ctx, { perPage: resolved.perPage, hasQuote: resolved.quote });
    return;
  }
  if (resolved.mode === 'multi_spread') {
    if (resolved.manualPages) {
      buildMultiSpreadManual(ctx, {
        pages: resolved.manualPages,
        hasQuote: resolved.quote,
        isPersonal: resolved.isPersonal,
      });
    } else {
      buildMultiSpreadSemantic(ctx, {
        spreadsPerStudent: resolved.spreadsPerStudent,
        hasQuote: resolved.quote,
        isPersonal: resolved.isPersonal,
      });
    }
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
function buildPageSemantic(
  ctx: SectionFillContext,
  params: { friends: number; hasQuote: boolean; isPersonal: boolean },
): void {
  const preset = ctx.bundle.preset;
  const photosFriend = params.friends;
  const hasQuote = params.hasQuote;
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
      ...personalTag(ctx, params.isPersonal, i),
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
function buildSpreadSemantic(
  ctx: SectionFillContext,
  params: { friendsMin: number; friendsMax: number; hasQuote: boolean; isPersonal: boolean },
): void {
  const preset = ctx.bundle.preset;
  const hasQuote = params.hasQuote;
  const students = ctx.input.students;

  for (let i = 0; i < students.length; i++) {
    const student = students[i];

    // ТЗ 17.06.2026: число фото с друзьями — ДИАПАЗОНОМ. На каждого ученика
    // берём мастер под ЕГО фактическое число фото, ограниченное диапазоном.
    // Для legacy-пресета friendsMin=friendsMax → photosFriendRequired фиксирован
    // (старое поведение, регресс-безопасно).
    const actualFriendPhotos = student.friend_photos?.length ?? 0;
    const photosFriendRequired = Math.max(
      params.friendsMin,
      Math.min(params.friendsMax, actualFriendPhotos),
    );

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

    const pTag = personalTag(ctx, params.isPersonal, i);
    ctx.pageInstances.push({
      master_id: leftResult.master.id,
      bindings: leftBindings,
      ...pTag,
    });
    ctx.pageInstances.push({
      master_id: rightResult.master.id,
      bindings: rightBindings,
      ...pTag,
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
 *   studentportrait / studentportrait_N → student.portrait
 *   studentname / studentname_N         → student.full_name
 *   studentquote / studentquote_N       → student.quote
 *   studentphoto_N / studentphotoN / friendphoto_N → student.friend_photos[N-1]
 *
 * Метки портрета/имени/цитаты принимаются как без номера (studentportrait),
 * так и с номером (studentportrait_1) — мастера E-Universal/E-Standard
 * именуют их с номером. Номер здесь — это НЕ индекс ученика (на одностраничном
 * мастере всегда один ученик), просто часть имени слота. Это отличает биндер
 * одиночного ученика от grid-биндера, где номер = индекс ученика.
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

    if (/^studentportrait(_\d+)?$/.test(label)) {
      bindings[ph.label] = student.portrait;
      continue;
    }
    if (/^studentname(_\d+)?$/.test(label)) {
      bindings[ph.label] = student.full_name;
      continue;
    }
    if (/^studentquote(_\d+)?$/.test(label)) {
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

// ─── Multi-spread semantic (ТЗ 17.06.2026) ─────────────────────────────────

/** Сколько слотов фото-с-друзьями (studentphoto_N / friendphoto_N) в мастере. */
function countFriendPhotoSlots(master: SpreadTemplate): number {
  let n = 0;
  for (const ph of master.placeholders) {
    if (/^(?:studentphoto|friendphoto)_?\d+$/.test(ph.label.toLowerCase())) n++;
  }
  return n;
}

/**
 * Bindings для коллажной страницы (только фото, без портрета/имени/цитаты).
 * Привязывает studentphoto_N/friendphoto_N → friends[offset + N - 1], чтобы
 * коллажные развороты показывали ДРУГИЕ фото, а не дублировали парадные.
 *
 * Пустые слоты (фото не хватило — последняя страница коллажа) скрываются
 * через `__hidden__<label>='1'` по аналогии с grid-биндером (РЭ.31.3), чтобы
 * на странице не висели пустые рамки. Жадный автопак минимизирует такие
 * случаи (страница подбирается под остаток фото), но последняя коллажная
 * страница может быть не до конца заполнена.
 */
function bindCollagePhotos(
  master: SpreadTemplate,
  student: RulesStudentInput,
  offset: number,
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  const friends = student.friend_photos ?? [];
  for (const ph of master.placeholders) {
    const m = ph.label.toLowerCase().match(/^(?:studentphoto|friendphoto)_?(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      const photo = friends[offset + n - 1];
      if (photo) {
        bindings[ph.label] = photo;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
    }
  }
  return bindings;
}

/** Есть ли в мастере плейсхолдер, чьё имя матчит регекс. */
function hasPlaceholderMatching(master: SpreadTemplate, re: RegExp): boolean {
  for (const ph of master.placeholders) {
    if (re.test(ph.label.toLowerCase())) return true;
  }
  return false;
}

/** Коллажный мастер личного раздела + его ёмкость (число фото-слотов). */
interface CollageMaster {
  master: SpreadTemplate;
  capacity: number;
}

/**
 * Коллажные мастера личного раздела для multi_spread — отсортированы по
 * ёмкости (число фото-слотов) убыванию, tie-break по имени.
 *
 * РАСПОЗНАЁМ ПО РЕАЛЬНЫМ СЛОТАМ, а не по slot_capacity/имени. Причина: одно
 * и то же имя (E-Standard-Right) в разных наборах значит разное (в «Аква меч»
 * это 3 фото без портрета — готовый коллаж; в «Белом» — портрет+имя). Поэтому
 * метаданные family-mapping ненадёжны. Коллаж = страница, где есть фото-слоты
 * (studentphoto_N / friendphoto_N) И НЕТ портрета, имени, цитаты.
 *
 * Так `E-Standard-Right` из «Аква меч» подхватывается уже сейчас, а будущие
 * `E-Collage-2/4/6` от дизайнера — автоматически, без правки кода.
 */
function findPersonalCollageMasters(
  ctx: SectionFillContext,
  presetId: string,
): CollageMaster[] {
  const out: CollageMaster[] = [];
  for (const m of Array.from(ctx.bundle.mastersByName.values())) {
    const applies = m.applies_to_configs;
    const matchesPreset =
      !applies || applies.length === 0 || (applies as readonly string[]).includes(presetId);
    if (!matchesPreset) continue;

    const capacity = countFriendPhotoSlots(m);
    if (capacity < 1) continue;
    // Чистый коллаж: нет портрета / имени / цитаты (по реальным плейсхолдерам).
    if (hasPlaceholderMatching(m, /^studentportrait(_\d+)?$/)) continue;
    if (hasPlaceholderMatching(m, /^studentname(_\d+)?$/)) continue;
    if (hasPlaceholderMatching(m, /^studentquote(_\d+)?$/)) continue;

    out.push({ master: m, capacity });
  }
  out.sort((a, b) => b.capacity - a.capacity || a.master.name.localeCompare(b.master.name));
  return out;
}

/**
 * Выбрать коллажный мастер под ЦЕЛЕВОЕ число фото на странице `target`:
 * предпочитаем точное совпадение ёмкости (страница заполнится без пустых
 * слотов), иначе — ближайший по ёмкости (tie → крупнее). Список ОБЯЗАН быть
 * непустым. Используется равномерным распределением (см. distributeCollagePages).
 */
function pickCollageByTarget(collageMasters: CollageMaster[], target: number): CollageMaster {
  for (const cm of collageMasters) {
    if (cm.capacity === target) return cm;
  }
  let best = collageMasters[0];
  let bestDist = Math.abs(best.capacity - target);
  for (const cm of collageMasters) {
    const d = Math.abs(cm.capacity - target);
    if (d < bestDist || (d === bestDist && cm.capacity > best.capacity)) {
      best = cm;
      bestDist = d;
    }
  }
  return best;
}

/**
 * multi_spread «Авто» (ТЗ 17.06.2026, переписано под видение Сергея):
 * один ученик на 1..`spreads_per_student` разворотов (cap 2..4).
 *
 * Модель блока ученика:
 *   Разворот 1: ЛЕВАЯ — парадная (портрет + ФИО + цитата), ПРАВАЯ — коллаж фото.
 *   Развороты 2..N: обе страницы — коллаж фото ученика.
 * Так парад — это ОДНА страница, дубль портрета на правой исчезает структурно.
 *
 * Коллаж подбирается автоматически под число фото ученика (как автопак общего
 * раздела): на каждую страницу берём самый крупный помещающийся коллаж из
 * присутствующих в наборе, остаток — мельче. У кого 8 фото, у кого 15 — система
 * сама решает сколько коллажных страниц.
 *
 * Парность: блок ученика ВСЕГДА занимает целое число разворотов (чётное число
 * страниц), чтобы у следующего ученика парад снова попал на левую страницу.
 * Поэтому коллажные страницы добавляются целыми разворотами; последняя правая
 * страница может быть не до конца заполнена (пустые слоты скрыты).
 *
 * Если в наборе НЕТ коллажных мастеров — degrade: строим парадный разворот
 * по старой схеме (left портрет + right через findStudentMaster) + warning.
 */
function buildMultiSpreadSemantic(
  ctx: SectionFillContext,
  params: { spreadsPerStudent: number; hasQuote: boolean; isPersonal: boolean },
): void {
  const preset = ctx.bundle.preset;
  const students = ctx.input.students;
  const maxSpreads = Math.max(2, Math.min(4, params.spreadsPerStudent));

  // Коллажные мастера набора — один раз на секцию (по реальным слотам).
  const collageMasters = findPersonalCollageMasters(ctx, preset.id);

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const friends = student.friend_photos ?? [];
    const startPages = ctx.pageInstances.length;
    const pTag = personalTag(ctx, params.isPersonal, i);

    // Парадная ЛЕВАЯ страница: портрет + ФИО + цитата.
    const leftResult = findStudentMaster(ctx.bundle.mastersByName, {
      presetId: preset.id,
      pageRole: 'student_left',
      photosFriend: 0,
      hasPortrait: true,
    });
    if (!leftResult) {
      ctx.warnings.push(
        `students_master_not_found: для пресета '${preset.id}' (mode=multi_spread) ` +
          `для ученика '${student.full_name}' не найден парадный мастер ` +
          `(student_left с портретом). Закажите мастер у дизайнера.`,
      );
      continue;
    }

    ctx.pageInstances.push({
      master_id: leftResult.master.id,
      bindings: bindSingleStudent(leftResult.master, student),
      ...pTag,
    });
    // Парадный мастер может сам содержать фото-слоты (например E-Universal-Left) —
    // тогда часть фото уже легла на парад, коллажи стартуют с этого смещения.
    let cursor = countFriendPhotoSlots(leftResult.master);

    // Degrade: коллажных мастеров нет — достраиваем правую парадную по старой
    // схеме (фото с друзьями + цитата), чтобы разворот был целым, + warning.
    if (collageMasters.length === 0) {
      const rightResult = findStudentMaster(ctx.bundle.mastersByName, {
        presetId: preset.id,
        pageRole: 'student_right',
        photosFriend: friends.length - cursor,
        hasQuote: params.hasQuote,
      });
      if (rightResult) {
        ctx.pageInstances.push({
          master_id: rightResult.master.id,
          bindings: bindCollagePhotos(rightResult.master, student, cursor),
          ...pTag,
        });
      }
      ctx.warnings.push(
        `students_multi_spread_no_collage_master: у ученика '${student.full_name}' ` +
          `в наборе нет коллажных мастеров личного раздела (страниц только с фото, ` +
          `без портрета/имени/цитаты). Построен только парадный разворот. ` +
          `Закажите коллажные мастера (E-Collage-*) у дизайнера.`,
      );
      pushMultiSpreadTrace(ctx, {
        startPages,
        studentIndex: i,
        studentName: student.full_name,
        maxSpreads,
        spreadsBuilt: 1,
        friendsTotal: friends.length,
        friendsPlaced: Math.min(cursor, friends.length),
        paradeLeft: leftResult.master.name,
        degraded: true,
      });
      continue;
    }

    // РАВНОМЕРНОЕ распределение коллажей (правка 17.06: было жадно «6+6+остаток»,
    // последняя страница выходила почти пустой — стало «5+4+4» на 13 фото).
    //
    // 1. Сколько коллажных страниц нужно: минимум, чтобы вместить все фото
    //    (по самому крупному коллажу), НО блок ученика занимает целые развороты —
    //    парад (1 стр.) + P коллажей → (1+P) чётно → P нечётно. Округляем вверх
    //    до нечётного. Ограничиваем бюджетом разворотов (maxSpreads*2 − 1, тоже нечёт).
    const maxCap = collageMasters[0].capacity; // отсортированы по убыванию
    const maxCollagePages = maxSpreads * 2 - 1;
    let collagePages = Math.max(1, Math.ceil((friends.length - cursor) / maxCap));
    if (collagePages % 2 === 0) collagePages += 1; // нечётное → целые развороты
    if (collagePages > maxCollagePages) collagePages = maxCollagePages;

    // 2. Раскидываем оставшиеся фото поровну: на каждой странице
    //    ceil(остаток / страниц_осталось) — даёт равные пачки (13/3=5, 8/2=4, 4/1=4).
    //    Берём мастер ровно под это число (точное совпадение ёмкости = без пустот).
    for (let k = 0; k < collagePages; k++) {
      const remaining = friends.length - cursor;
      const pagesLeft = collagePages - k;
      const target = remaining > 0 ? Math.ceil(remaining / pagesLeft) : 1;
      const pick = pickCollageByTarget(collageMasters, target);
      ctx.pageInstances.push({
        master_id: pick.master.id,
        bindings: bindCollagePhotos(pick.master, student, cursor),
        ...pTag,
      });
      cursor += pick.capacity; // смещение на ёмкость страницы (лишние слоты скрыты)
    }
    const spreadsBuilt = (1 + collagePages) / 2;

    // Фото, не вместившиеся в cap разворотов — остаются в пуле партнёра.
    if (cursor < friends.length) {
      ctx.warnings.push(
        `students_lost_photos: у ученика '${student.full_name}' (mode=multi_spread) ` +
          `${friends.length - cursor} фото не размещены в layout ` +
          `(не хватило разворотов ${maxSpreads}; фото сохранены в пуле партнёра)`,
      );
    }

    pushMultiSpreadTrace(ctx, {
      startPages,
      studentIndex: i,
      studentName: student.full_name,
      maxSpreads,
      spreadsBuilt,
      friendsTotal: friends.length,
      friendsPlaced: Math.min(cursor, friends.length),
      paradeLeft: leftResult.master.name,
      degraded: false,
    });
  }
}

function pushMultiSpreadTrace(
  ctx: SectionFillContext,
  t: {
    startPages: number;
    studentIndex: number;
    studentName: string;
    maxSpreads: number;
    spreadsBuilt: number;
    friendsTotal: number;
    friendsPlaced: number;
    paradeLeft: string;
    degraded: boolean;
  },
): void {
  ctx.decisionTrace.push({
    spread_index: Math.floor(t.startPages / 2),
    section_index: ctx.sectionIndex,
    family_id: 'student-section',
    rule_id: `multi_spread_auto:${t.paradeLeft}${t.degraded ? ':degraded' : ''}`,
    inputs: {
      mode: 'multi_spread',
      student_index: t.studentIndex,
      student_name: t.studentName,
      spreads_per_student_cap: t.maxSpreads,
      spreads_built: t.spreadsBuilt,
      friend_photos_total: t.friendsTotal,
      friend_photos_placed: t.friendsPlaced,
      parade_left: t.paradeLeft,
    },
  });
}

/**
 * Bindings страницы личного блока для РУЧНОГО multi_spread. Универсально:
 * привязывает портрет/имя/цитату (если такие слоты есть в мастере) И фото
 * со смещением `photoOffset` (studentphoto_N/friendphoto_N → friends[offset+N-1],
 * пустые скрываются __hidden__). Так одна функция обслуживает любой мастер,
 * который партнёр поставил в последовательность — парадный (с портретом) или
 * чисто коллажный (только фото).
 */
function bindStudentPageWithOffset(
  master: SpreadTemplate,
  student: RulesStudentInput,
  photoOffset: number,
  hasQuote: boolean,
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  const friends = student.friend_photos ?? [];
  for (const ph of master.placeholders) {
    const label = ph.label.toLowerCase();

    if (/^studentportrait(_\d+)?$/.test(label)) {
      bindings[ph.label] = student.portrait;
      continue;
    }
    if (/^studentname(_\d+)?$/.test(label)) {
      bindings[ph.label] = student.full_name;
      continue;
    }
    if (/^studentquote(_\d+)?$/.test(label)) {
      bindings[ph.label] = hasQuote ? student.quote ?? null : null;
      continue;
    }
    const m = label.match(/^(?:studentphoto|friendphoto)_?(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      const photo = friends[photoOffset + n - 1];
      if (photo) {
        bindings[ph.label] = photo;
      } else {
        bindings[`__hidden__${ph.label}`] = '1';
      }
    }
  }
  return bindings;
}

/**
 * multi_spread РУЧНОЙ (ТЗ 17.06.2026): партнёр сам перечислил мастера страниц
 * личного блока. Применяем эту последовательность к КАЖДОМУ ученику; фото
 * текут слева направо (cursor по числу фото-слотов каждой страницы).
 *
 * Каждая страница биндится универсально (портрет/имя/цитата если есть + фото
 * со смещением). Неизвестное имя мастера → warning + страница пропускается.
 * Длина `pages` чётная (целые развороты) — гарантируется валидатором API.
 */
function buildMultiSpreadManual(
  ctx: SectionFillContext,
  params: { pages: string[]; hasQuote: boolean; isPersonal: boolean },
): void {
  const students = ctx.input.students;

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const friends = student.friend_photos ?? [];
    const startPages = ctx.pageInstances.length;
    const pTag = personalTag(ctx, params.isPersonal, i);
    let cursor = 0;
    let pagesBuilt = 0;

    for (const masterName of params.pages) {
      const master = ctx.bundle.mastersByName.get(masterName);
      if (!master) {
        // Предупреждаем один раз на ученика хватило бы, но порядок страниц
        // важен — сообщаем по каждому отсутствующему мастеру.
        ctx.warnings.push(
          `students_master_not_found: для ученика '${student.full_name}' (mode=multi_spread/ручной) ` +
            `мастер '${masterName}' отсутствует в template_set дизайна. Страница пропущена.`,
        );
        continue;
      }
      ctx.pageInstances.push({
        master_id: master.id,
        bindings: bindStudentPageWithOffset(master, student, cursor, params.hasQuote),
        ...pTag,
      });
      cursor += countFriendPhotoSlots(master);
      pagesBuilt++;
    }

    if (cursor < friends.length) {
      ctx.warnings.push(
        `students_lost_photos: у ученика '${student.full_name}' (mode=multi_spread/ручной) ` +
          `${friends.length - cursor} фото не размещены в layout ` +
          `(в выбранной раскладке не хватило фото-слотов; фото сохранены в пуле партнёра)`,
      );
    }

    ctx.decisionTrace.push({
      spread_index: Math.floor(startPages / 2),
      section_index: ctx.sectionIndex,
      family_id: 'student-section',
      rule_id: `multi_spread_manual:${params.pages.join('+')}`,
      inputs: {
        mode: 'multi_spread',
        layout: 'manual',
        student_index: i,
        student_name: student.full_name,
        pages_requested: params.pages.length,
        pages_built: pagesBuilt,
        friend_photos_total: friends.length,
        friend_photos_placed: Math.min(cursor, friends.length),
      },
    });
  }
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
function buildGridSemantic(
  ctx: SectionFillContext,
  params: { perPage: number | null | undefined; hasQuote: boolean },
): void {
  const preset = ctx.bundle.preset;
  const gridSize = params.perPage;
  const hasQuote = params.hasQuote;

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
  //
  // Combined-мастер — это student-grid с дополнительным общим фото
  // (photos_full=1). У него ОБЯЗАТЕЛЬНО должны быть студенческие слоты
  // с has_portrait=true И has_name=true — это отличает его от
  // transition combo-мастеров (J-Combined-Tail-2/3/4 РЭ.37.4), у которых
  // has_portrait/has_name=undefined.
  //
  // ВАЖНО: combined должен быть из той же density (семьи) что и base.
  // Иначе для Light шаблона может выбраться N-Combined-Page (Mini, 4
  // студента) вместо L-Combined-Page (Light, 3 студента) — баг 2026-05-25.
  //
  // Эвристика семьи: совпадает первый сегмент имени до '-' (L-Grid-Page
  // → L-Combined-Page, N-Grid-Page → N-Combined-Page).
  //
  // Если у дизайнера имена не следуют этой схеме — fallback: берём
  // combined с минимальным students (как самый «компактный»), это
  // обычно подходит для Light.
  const basePrefix = baseMaster.name.split('-')[0]; // 'L' / 'M' / 'N' / ...
  let combinedMaster: SpreadTemplate | null = null;
  let combinedCapacity: number | null = null;
  const allMasters = Array.from(ctx.bundle.mastersByName.values());
  const combinedCandidates: SpreadTemplate[] = [];
  for (const m of allMasters) {
    if (!m.slot_capacity) continue;
    const photosFullN =
      typeof m.slot_capacity.photos_full === 'number' ? m.slot_capacity.photos_full : 0;
    const studentsN =
      typeof m.slot_capacity.students === 'number' ? m.slot_capacity.students : 0;
    const hasPortrait = m.slot_capacity.has_portrait === true;
    const hasName = m.slot_capacity.has_name === true;
    // Жёсткий фильтр: photos_full=1, has_portrait=true, has_name=true.
    // Это отсекает J-Combined-Tail-* (для transition) — у них нет
    // has_portrait/has_name.
    if (
      photosFullN === 1 &&
      hasPortrait &&
      hasName &&
      studentsN >= 1 &&
      studentsN < slotsPerPage
    ) {
      combinedCandidates.push(m);
    }
  }

  // Шаг 1: предпочитаем кандидата с тем же семейным префиксом что и base.
  const sameFamily = combinedCandidates.filter((m) =>
    m.name.startsWith(basePrefix + '-'),
  );
  if (sameFamily.length > 0) {
    // Если несколько (что маловероятно) — берём максимальный по students.
    sameFamily.sort(
      (a, b) =>
        (b.slot_capacity?.students ?? 0) - (a.slot_capacity?.students ?? 0),
    );
    combinedMaster = sameFamily[0];
    combinedCapacity = combinedMaster.slot_capacity?.students ?? null;
  } else if (combinedCandidates.length > 0) {
    // Шаг 2: нет совпадения по семье — fallback на МИНИМАЛЬНЫЙ students.
    // Это разумный default: combined с малым числом учеников чаще всего
    // помещается на любую density. Раньше я брал максимальный — это
    // даёт Mini-стиль на Light-шаблонах. Исправлено 2026-05-25.
    combinedCandidates.sort(
      (a, b) =>
        (a.slot_capacity?.students ?? 0) - (b.slot_capacity?.students ?? 0),
    );
    combinedMaster = combinedCandidates[0];
    combinedCapacity = combinedMaster.slot_capacity?.students ?? null;
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
