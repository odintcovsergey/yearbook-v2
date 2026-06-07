/**
 * Сборщик фотопапки-тримо (фиксированная раскладка, Этап 2).
 *
 * Чистая логика, без БД: по входу (мастера + данные класса + режим) раскладывает
 * данные по меткам панелей, как это делают сборка разворотов альбома
 * (SpreadInstance.data) и обложки (lib/cover/assemble.ts).
 *
 * Раскладка (см. types.ts / memory project_photofolder):
 *   Разворот 1: групповые / групповые / обложка папки (cover_*)
 *   Разворот 2: классрук(+предметники) / сетка / сетка (плавающая, см. grid.ts)
 *
 * Режим персонализации:
 *   - portrait_personal (базовый): по папке на ученика, персонален только портрет
 *     на обложке (cover_portrait) + ФИО (cover_student_name); остальное общее.
 *   - full_personal: КАРКАС — в этой итерации ведёт себя как базовый. Конкретные
 *     правила полной персонализации добавим когда придёт макет другого фотографа.
 *
 * Управляемость (выбор мастеров по панелям) — следующий этап; здесь раскладка
 * выводится из меток мастера и их панелей (computePanelZones).
 */

import type { Student } from '../album-builder/types';
import { planFloatingGrid, type GridPanel } from './grid';
import {
  INDEXED,
  LABELS,
  type PhotofolderInput,
  type PhotofolderInstance,
  type PhotofolderMaster,
  type PhotofolderResult,
  type PhotofolderShared,
  type PhotofolderSlot,
  type PhotofolderWarning,
} from './types';

/** Панель слота, нормализованная к числу (undefined → 0). */
function panelOf(slot: PhotofolderSlot): number {
  return slot.panel ?? 0;
}

/** Числовой суффикс индексированной метки `<base>_<N>` или 0, если его нет. */
function suffixOf(label: string): number {
  const m = label.match(/_(\d+)$/);
  return m ? Number(m[1]) : 0;
}

// ─── Разворот 1: групповые + обложка папки ────────────────────────────────

/**
 * Общая (для всех папок класса) часть разворота 1: групповые фото + общие
 * поля обложки. Персональные cover_portrait / cover_student_name НЕ заполняет —
 * их докладывает assemble на каждого ученика.
 */
function fillSpread1Shared(
  master: PhotofolderMaster,
  groupPhotos: string[],
  shared: PhotofolderShared,
): Record<string, string | null> {
  const data: Record<string, string | null> = {};
  let groupCursor = 0;

  // Групповые фото раскладываем по меткам слева направо, сверху вниз.
  const groupSlots = master.slots
    .filter((s) => INDEXED.groupPhoto.test(s.label))
    .sort((a, b) => panelOf(a) - panelOf(b) || suffixOf(a.label) - suffixOf(b.label));
  for (const slot of groupSlots) {
    data[slot.label] = groupPhotos[groupCursor] ?? null;
    groupCursor++;
  }

  // Общие поля обложки папки.
  for (const slot of master.slots) {
    switch (slot.label) {
      case LABELS.coverCommonPhoto:
        data[slot.label] = shared.cover_common_photo_url;
        break;
      case LABELS.coverTitle:
        data[slot.label] = shared.title;
        break;
      case LABELS.coverSchoolName:
        data[slot.label] = shared.school_name;
        break;
      case LABELS.coverCity:
        data[slot.label] = shared.city;
        break;
      case LABELS.coverYear:
        data[slot.label] = shared.year;
        break;
      case LABELS.coverClass:
        data[slot.label] = shared.classes;
        break;
      default:
        break;
    }
  }
  return data;
}

// ─── Разворот 2: учителя + плавающая сетка учеников ───────────────────────

/**
 * Разворот 2 целиком общий (одинаков для всех папок класса): классрук +
 * предметники на панели учителей, сетка учеников по плавающему плану.
 */
function fillSpread2(
  master: PhotofolderMaster,
  input: PhotofolderInput,
  warnings: PhotofolderWarning[],
): Record<string, string | null> {
  const data: Record<string, string | null> = {};

  fillTeachers(master, input, data, warnings);
  fillStudentGrid(master, input.students, data, warnings);

  return data;
}

function fillTeachers(
  master: PhotofolderMaster,
  input: PhotofolderInput,
  data: Record<string, string | null>,
  warnings: PhotofolderWarning[],
): void {
  const head = input.head_teacher;
  if (!head) {
    warnings.push({
      code: 'no_head_teacher',
      detail: 'head_teacher=null — панель учителей без классного руководителя',
    });
  }

  for (const slot of master.slots) {
    switch (slot.label) {
      case LABELS.headTeacherPhoto:
        data[slot.label] = head?.photo ?? null;
        break;
      case LABELS.headTeacherName:
        data[slot.label] = head?.name ?? null;
        break;
      case LABELS.headTeacherRole:
        data[slot.label] = head?.role ?? null;
        break;
      case LABELS.headTextFrame:
        data[slot.label] = head?.text ?? null;
        break;
      default:
        break;
    }
  }

  // Предметники по индексу (teacherphoto_N / teachername_N / teacherrole_N).
  const subjects = input.subjects;
  fillIndexed(master, INDEXED.teacherPhoto, data, (n) => subjects[n - 1]?.photo ?? null);
  fillIndexed(master, INDEXED.teacherName, data, (n) => subjects[n - 1]?.name ?? null);
  fillIndexed(master, INDEXED.teacherRole, data, (n) => subjects[n - 1]?.role ?? null);
}

/**
 * Сетка учеников с плавающим стартом. Считает ёмкость каждой панели по числу
 * studentportrait_* слотов, решает (panel_0 учителей или только панели 1-2)
 * через planFloatingGrid, затем раскладывает учеников в порядке использованных
 * панелей слева направо, внутри панели — по суффиксу метки.
 */
function fillStudentGrid(
  master: PhotofolderMaster,
  students: Student[],
  data: Record<string, string | null>,
  warnings: PhotofolderWarning[],
): void {
  // studentportrait_* слоты, сгруппированные по панели и отсортированные по суффиксу.
  const portraitByPanel = groupSlotsByPanel(master, INDEXED.studentPortrait);
  // studentname_* по панели → map suffix→slot для парного заполнения имени.
  const nameByPanel = groupSlotsByPanel(master, INDEXED.studentName);

  // Все ученические слоты по умолчанию пустые (null). Использованные панели
  // ниже перезапишут свои; слоты на неиспользованной панели (например учителя,
  // когда сетка влезла в панели 1-2) так и останутся null, а не undefined.
  portraitByPanel.forEach((slots) => slots.forEach((s) => (data[s.label] = null)));
  nameByPanel.forEach((slots) => slots.forEach((s) => (data[s.label] = null)));

  // Все панели с ученическими слотами, по возрастанию индекса.
  const portraitPanels = Array.from(portraitByPanel.keys()).sort((a, b) => a - b);

  // Если ученических слотов нет вовсе — выходим (пустая сетка).
  if (portraitPanels.length === 0) {
    if (students.length > 0) {
      warnings.push({
        code: 'students_overflow',
        detail: `${students.length} учеников, но в мастере нет studentportrait слотов`,
      });
    }
    return;
  }

  if (students.length === 0) {
    warnings.push({ code: 'students_empty', detail: 'students пуст — сетка пустая' });
  }

  // Панель учителей = наименьший индекс (panel_0); остальные — сетка по умолчанию.
  const teacherPanelIdx = portraitPanels[0];
  const teacherPanel: GridPanel = {
    panel: teacherPanelIdx,
    capacity: portraitByPanel.get(teacherPanelIdx)!.length,
  };
  const gridPanels: GridPanel[] = portraitPanels
    .slice(1)
    .map((p) => ({ panel: p, capacity: portraitByPanel.get(p)!.length }));

  // Особый случай: ученические слоты только на одной панели — она и есть сетка.
  const plan =
    gridPanels.length === 0
      ? planFloatingGrid(students.length, { panel: teacherPanelIdx, capacity: 0 }, [teacherPanel])
      : planFloatingGrid(students.length, teacherPanel, gridPanels);

  // Раскладываем учеников в порядке использованных панелей.
  let cursor = 0;
  plan.usedPanels.forEach((gp, k) => {
    const count = plan.distribution.perPanel[k];
    const portraits = portraitByPanel.get(gp.panel)!;
    const names = nameByPanel.get(gp.panel) ?? [];
    const nameBySuffix = new Map(names.map((s) => [suffixOf(s.label), s]));

    for (let i = 0; i < portraits.length; i++) {
      const pSlot = portraits[i];
      const nSlot = nameBySuffix.get(suffixOf(pSlot.label));
      if (i < count) {
        const student = students[cursor];
        data[pSlot.label] = student.portrait;
        if (nSlot) data[nSlot.label] = student.full_name;
        cursor++;
      } else {
        // Слот за пределами числа учеников — пустой.
        data[pSlot.label] = null;
        if (nSlot) data[nSlot.label] = null;
      }
    }
  });

  if (plan.distribution.overflow > 0) {
    warnings.push({
      code: 'students_overflow',
      detail: `${plan.distribution.overflow} учеников не поместились в сетку`,
    });
  }
}

// ─── Утилиты ──────────────────────────────────────────────────────────────

/** Заполняет индексированные слоты мастера значением по индексу N (1-based). */
function fillIndexed(
  master: PhotofolderMaster,
  re: RegExp,
  data: Record<string, string | null>,
  value: (n: number) => string | null,
): void {
  for (const slot of master.slots) {
    if (re.test(slot.label)) {
      data[slot.label] = value(suffixOf(slot.label));
    }
  }
}

/** Группирует слоты, подходящие под re, по панели; внутри — сортировка по суффиксу. */
function groupSlotsByPanel(
  master: PhotofolderMaster,
  re: RegExp,
): Map<number, PhotofolderSlot[]> {
  const byPanel = new Map<number, PhotofolderSlot[]>();
  for (const slot of master.slots) {
    if (!re.test(slot.label)) continue;
    const p = panelOf(slot);
    if (!byPanel.has(p)) byPanel.set(p, []);
    byPanel.get(p)!.push(slot);
  }
  byPanel.forEach((slots) => slots.sort((a, b) => suffixOf(a.label) - suffixOf(b.label)));
  return byPanel;
}

// ─── Оркестрация ────────────────────────────────────────────────────────────

/**
 * Собирает фотопапки для всего класса. По папке на ученика (персонализация
 * портрета на обложке); если учеников нет — одна общая папка (child_id=null).
 */
export function assemblePhotofolder(input: PhotofolderInput): PhotofolderResult {
  const warnings: PhotofolderWarning[] = [];

  const master1 = input.masters.find((m) => m.spread_index === 0) ?? null;
  const master2 = input.masters.find((m) => m.spread_index === 1) ?? null;
  if (!master1) {
    warnings.push({ code: 'master_missing', detail: 'нет мастера разворота 1' });
  }
  if (!master2) {
    warnings.push({ code: 'master_missing', detail: 'нет мастера разворота 2' });
  }

  if (input.group_photos.length === 0) {
    warnings.push({ code: 'no_group_photos', detail: 'group_photos пуст' });
  }

  // Общие части разворотов (считаем один раз).
  const spread1Shared = master1
    ? fillSpread1Shared(master1, input.group_photos, input.shared)
    : {};
  const spread2Data = master2 ? fillSpread2(master2, input, warnings) : {};

  const spread2 = {
    spread_index: 1,
    master_id: master2?.id ?? null,
    master_name: master2?.name ?? null,
    data: spread2Data,
  };

  // Собираем по папке на ученика; персонализируем обложку (портрет + ФИО).
  const buildInstance = (student: Student | null): PhotofolderInstance => {
    const spread1Data = { ...spread1Shared };
    if (master1) {
      for (const slot of master1.slots) {
        if (slot.label === LABELS.coverPortrait) {
          spread1Data[slot.label] = student?.portrait ?? null;
        } else if (slot.label === LABELS.coverStudentName) {
          spread1Data[slot.label] = student?.full_name ?? null;
        }
      }
    }
    return {
      // child_id заполнит будущий loader (album-builder Student не несёт id).
      // Порядок instances совпадает с input.students — loader зипует по позиции.
      child_id: null,
      spreads: [
        {
          spread_index: 0,
          master_id: master1?.id ?? null,
          master_name: master1?.name ?? null,
          data: spread1Data,
        },
        spread2,
      ],
    };
  };

  const instances =
    input.students.length === 0
      ? [buildInstance(null)]
      : input.students.map((s) => buildInstance(s));

  return { mode: input.mode, instances, warnings };
}
