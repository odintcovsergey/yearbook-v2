/**
 * РЭ.24.3: генерация набора ключевых SVG-превью для шаблона.
 *
 * Чистая функция: принимает Preset + RuleEngineBundle, делает dry-run
 * сборку альбома с фиктивными данными, выделяет 4 «ключевых» разворота
 * и рендерит каждый через renderPreviewSvg (из РЭ.23.2).
 *
 * Используется в РЭ.24.4 (API templates_list_global/_my) для отдачи
 * превью карточек каталога.
 *
 * Алгоритм:
 *   1. Сформировать фиктивный RulesAlbumInput (10 учеников, 5 учителей,
 *      1 фото класса, head_teacher).
 *   2. Вызвать buildFromSectionStructure(bundle, fakeInput).
 *   3. Пройтись по decision_trace — каждая запись содержит section_index
 *      и family_id (student-section / common-section / intro / final /
 *      head-teacher). Используем это чтобы определить «корзину» для
 *      каждой страницы.
 *   4. Из mastersByName взять первый мастер с page_role='cover' для
 *      превью обложки (cover в section_structure не существует —
 *      обложка отдельная сущность).
 *   5. Для каждой корзины (students/teachers/soft) — взять ПЕРВУЮ
 *      страницу из этой корзины и отрендерить её мастер.
 *
 * Особенности:
 *  - Если у пресета нет какой-то секции — её значение = null.
 *  - Если engine упал (status='failed') — все 4 поля null.
 *  - Если в template_set нет cover-мастера — cover=null.
 *  - Для двухстраничных мастеров (is_spread=true) превью покажет
 *    обе страницы рядом (так уже устроено в renderPreviewSvg).
 */

import { renderPreviewSvg } from '@/lib/album-builder/render-preview-svg';
import { buildFromSectionStructure } from '@/lib/rule-engine/build-from-section-structure';
import type { RuleEngineBundle } from '@/lib/rule-engine/loaders';
import type { RulesAlbumInput } from '@/lib/rule-engine/types';
import type { SpreadTemplate } from '@/lib/album-builder/types';

export interface PresetPreviewBundle {
  /** Главное превью — личный раздел. Самое «характерное» для шаблона. */
  students: string | null;
  /** Превью обложки (если в template_set есть мастер с page_role='cover'). */
  cover: string | null;
  /** Превью учительского разворота (первая страница teachers-секции). */
  teachers: string | null;
  /** Превью soft_intro или soft_final (что есть в section_structure). */
  soft: string | null;
}

/**
 * Создаёт фиктивный RulesAlbumInput для dry-run сборки.
 *
 * Числа подобраны так, чтобы engine выбрал «средний» мастер по семантике:
 *  - 10 учеников: достаточно для grid из 4, 6 или 12, и для page/spread
 *  - 5 предметников: попадает в диапазон 5-8 → F-Head-LargeGrid (8 слотов)
 *  - 1 фото класса: для F-Head-WithClassPhoto-L, S-Intro, transition-right
 *  - 0 фото half_class / spread / quarter / sixth — не нужны для превью
 *  - head_teacher — обязателен для teachers-секции
 */
function makeFakeInput(): RulesAlbumInput {
  return {
    students: Array.from({ length: 10 }, (_, i) => ({
      portrait: `https://cdn.example.com/student${i}.jpg`,
      full_name: `Студент ${i + 1}`,
      // Никаких photos_friend по умолчанию — engine добавит pseudo если нужно
    })),
    subjects: Array.from({ length: 5 }, (_, i) => ({
      photo: `https://cdn.example.com/subject${i}.jpg`,
      name: `Учитель ${i + 1}`,
      role: `Предмет ${i + 1}`,
    })),
    head_teacher: {
      photo: 'https://cdn.example.com/head.jpg',
      name: 'Главный учитель',
      role: 'Директор',
      text: 'Тестовый текст для превью',
    },
    common_photos: {
      full_class: ['https://cdn.example.com/full0.jpg'],
      half_class: [],
      spread: [],
      quarter: [],
      sixth: [],
      collage: [],
    },
  };
}

/**
 * Главная функция. Возвращает 4 SVG-строки (или null где нечего показать).
 *
 * Никогда не бросает исключений. Если что-то пошло не так — соответствующее
 * поле просто будет null. Это нужно для безопасной работы в API: один
 * сломанный пресет не должен ломать весь каталог.
 */
export function buildPresetPreviewBundle(
  bundle: RuleEngineBundle,
): PresetPreviewBundle {
  const result: PresetPreviewBundle = {
    students: null,
    cover: null,
    teachers: null,
    soft: null,
  };

  // ─── Cover: ищем первый мастер с page_role='cover' независимо от engine ──
  // Обложка в section_structure не описывается — это отдельный мастер
  // в template_set. Берём первый подходящий.
  const coverMaster = findMasterByRole(bundle.mastersByName, 'cover');
  if (coverMaster) {
    try {
      result.cover = renderPreviewSvg(coverMaster);
    } catch {
      // Игнорируем — пусть будет null
    }
  }

  // ─── Engine dry-run для students / teachers / soft ──────────────────────
  let layout;
  try {
    layout = buildFromSectionStructure(bundle, makeFakeInput());
  } catch {
    // Engine упал — возвращаем что собрали (cover может быть установлен).
    return result;
  }

  // pageInstances в порядке появления. Используем decision_trace чтобы
  // определить тип каждой страницы.
  // decision_trace.spread_index указывает на индекс разворота, мы
  // восстанавливаем индекс страницы (страница 0 = разворот 0 left,
  // 1 = разворот 0 right, 2 = разворот 1 left и т.д.) но для нашей цели
  // достаточно знать что family_id уникален для каждой секции.
  //
  // Если engine ничего не построил (status=failed или spreads=0) —
  // НЕ выходим, переходим к fallback по page_role ниже.
  const engineProducedPages =
    layout.status !== 'failed' && layout.spreads.length > 0;

  if (engineProducedPages) {
    // Мастера по ID для быстрого lookup.
    const mastersById = new Map<string, SpreadTemplate>();
    bundle.mastersByName.forEach((m) => mastersById.set(m.id, m));

    // Собираем все pageInstances последовательно из spreads (обходим left,
    // потом right для каждого разворота).
    type Pi = { master_id: string };
    const allPages: Pi[] = [];
    for (const spread of layout.spreads) {
      if (spread.left) allPages.push({ master_id: spread.left.master_id });
      if (spread.right) allPages.push({ master_id: spread.right.master_id });
    }

    // Распределяем pageInstances по decision_trace.
    // decision_trace ↔ pageInstances 1:1 (одна запись на страницу).
    // Если расхождение — корректно деградируем (берём первый студенческий
    // мастер по семантике, см. fallback ниже).
    const trace = layout.decision_trace;
    if (trace.length === allPages.length) {
      for (let i = 0; i < trace.length; i++) {
        const family = trace[i].family_id;
        const page = allPages[i];
        const master = mastersById.get(page.master_id);
        if (!master) continue;

        // Берём ПЕРВУЮ страницу каждой корзины (последующие игнорируем).
        if (family === 'student-section' && result.students === null) {
          result.students = safeRender(master);
        } else if (family === 'head-teacher' && result.teachers === null) {
          result.teachers = safeRender(master);
        } else if (
          (family === 'intro' || family === 'final') &&
          result.soft === null
        ) {
          result.soft = safeRender(master);
        }
      }
    }
  }

  // Fallback: если decision_trace не помог (например размеры не совпали),
  // берём первого мастера по page_role в template_set. Это менее точно
  // но лучше чем ничего.
  if (result.students === null) {
    const sm =
      findMasterByRole(bundle.mastersByName, 'student_grid') ??
      findMasterByRole(bundle.mastersByName, 'student_grid_left') ??
      findMasterByRole(bundle.mastersByName, 'student_left') ??
      findMasterByRole(bundle.mastersByName, 'student');
    if (sm) result.students = safeRender(sm);
  }
  if (result.teachers === null) {
    const tm = findMasterByRole(bundle.mastersByName, 'teacher_left');
    if (tm) result.teachers = safeRender(tm);
  }
  if (result.soft === null) {
    const im =
      findMasterByRole(bundle.mastersByName, 'intro') ??
      findMasterByRole(bundle.mastersByName, 'final');
    if (im) result.soft = safeRender(im);
  }

  return result;
}

// ─── Хелперы ────────────────────────────────────────────────────────────────

function findMasterByRole(
  mastersByName: ReadonlyMap<string, SpreadTemplate>,
  role: string,
): SpreadTemplate | null {
  let found: SpreadTemplate | null = null;
  mastersByName.forEach((m) => {
    if (found) return;
    if (m.page_role === role) found = m;
  });
  return found;
}

function safeRender(master: SpreadTemplate): string | null {
  try {
    return renderPreviewSvg(master);
  } catch {
    return null;
  }
}
