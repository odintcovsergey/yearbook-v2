/**
 * Плавающая сетка учеников фотопапки (разворот 2).
 *
 * ТЗ: «Сетка плавающая — может начаться у учителей или со 2-й панели в
 * зависимости от количества учеников.»
 *
 * Читаем слева направо: panel_0 — классрук(+предметники), panel_1 и panel_2 —
 * сетка. Если ученики помещаются в панели 1-2 — сетка стоит там, учителя
 * занимают panel_0 («со 2-й панели»). Если не помещаются — сетка заходит и на
 * panel_0 («начинается у учителей»), перераспределяясь по всем трём панелям.
 *
 * Чистые функции над ёмкостями (сколько ученических слотов на панели).
 * Реальные ёмкости считаются из числа studentportrait_* слотов мастера
 * (см. assemble.ts), здесь — параметрически, чтобы тестировать на синтетике.
 */

/** Панель-кандидат под сетку: индекс панели + сколько учеников вмещает. */
export type GridPanel = {
  panel: number;
  capacity: number;
};

/** Распределение учеников по панелям (по порядку переданных панелей). */
export type GridDistribution = {
  /** perPanel[k] — сколько учеников на panels[k]. */
  perPanel: number[];
  /** Размещено всего. */
  placed: number;
  /** Не поместилось (overflow). 0 — все влезли. */
  overflow: number;
};

/**
 * Раскладывает studentCount учеников последовательно по панелям слева направо,
 * заполняя каждую до её ёмкости. Лишнее уходит в overflow.
 */
export function distributeStudentsAcrossPanels(
  studentCount: number,
  panels: GridPanel[],
): GridDistribution {
  const perPanel = new Array<number>(panels.length).fill(0);
  let remaining = Math.max(0, studentCount);
  let placed = 0;

  for (let k = 0; k < panels.length; k++) {
    const take = Math.min(remaining, Math.max(0, panels[k].capacity));
    perPanel[k] = take;
    placed += take;
    remaining -= take;
  }

  return { perPanel, placed, overflow: remaining };
}

/** План плавающей сетки: использованные панели + распределение. */
export type FloatingGridPlan = {
  /** true — сетка заняла панель учителей (panel_0). Учителя в этом случае
   *  делят панель / уезжают (решает выбранный мастер; здесь — только флаг). */
  startsAtTeachers: boolean;
  /** Панели, реально отданные под сетку (по порядку слева направо). */
  usedPanels: GridPanel[];
  distribution: GridDistribution;
};

/**
 * Решает, где начинается сетка: со 2-й панели (панели 1-2) или у учителей
 * (panel_0 + панели 1-2).
 *
 * Сначала пробуем только gridPanels (обычно panel_1, panel_2). Если все
 * ученики влезли — startsAtTeachers=false. Иначе добавляем teacherPanel
 * первой (слева) и раскладываем по всем — startsAtTeachers=true.
 *
 * @param studentCount число учеников
 * @param teacherPanel panel_0: ёмкость = сколько учеников влезет, если отдать
 *        эту панель под сетку (0 — панель под сетку не годится)
 * @param gridPanels панели по умолчанию под сетку (panel_1, panel_2)
 */
export function planFloatingGrid(
  studentCount: number,
  teacherPanel: GridPanel,
  gridPanels: GridPanel[],
): FloatingGridPlan {
  const onlyGrid = distributeStudentsAcrossPanels(studentCount, gridPanels);
  if (onlyGrid.overflow === 0) {
    return {
      startsAtTeachers: false,
      usedPanels: gridPanels,
      distribution: onlyGrid,
    };
  }

  // Не влезли — подключаем панель учителей слева.
  const withTeachers = [teacherPanel, ...gridPanels];
  return {
    startsAtTeachers: teacherPanel.capacity > 0,
    usedPanels: withTeachers,
    distribution: distributeStudentsAcrossPanels(studentCount, withTeachers),
  };
}
