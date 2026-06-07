import { describe, it, expect } from 'vitest';
import {
  distributeStudentsAcrossPanels,
  planFloatingGrid,
  type GridPanel,
} from '../grid';

// Плавающая сетка фотопапки. Чистые функции над ёмкостями панелей.

describe('distributeStudentsAcrossPanels', () => {
  it('раскладывает слева направо, заполняя каждую панель до ёмкости', () => {
    const panels: GridPanel[] = [
      { panel: 1, capacity: 6 },
      { panel: 2, capacity: 6 },
    ];
    const d = distributeStudentsAcrossPanels(8, panels);
    expect(d.perPanel).toEqual([6, 2]);
    expect(d.placed).toBe(8);
    expect(d.overflow).toBe(0);
  });

  it('overflow, если учеников больше суммарной ёмкости', () => {
    const panels: GridPanel[] = [
      { panel: 1, capacity: 6 },
      { panel: 2, capacity: 6 },
    ];
    const d = distributeStudentsAcrossPanels(15, panels);
    expect(d.perPanel).toEqual([6, 6]);
    expect(d.placed).toBe(12);
    expect(d.overflow).toBe(3);
  });

  it('ноль учеников → все панели пустые', () => {
    const d = distributeStudentsAcrossPanels(0, [{ panel: 1, capacity: 6 }]);
    expect(d.perPanel).toEqual([0]);
    expect(d.placed).toBe(0);
    expect(d.overflow).toBe(0);
  });
});

describe('planFloatingGrid', () => {
  const teacherPanel: GridPanel = { panel: 0, capacity: 6 };
  const gridPanels: GridPanel[] = [
    { panel: 1, capacity: 6 },
    { panel: 2, capacity: 6 },
  ];

  it('мало учеников → сетка со 2-й панели, учителей не трогает', () => {
    const plan = planFloatingGrid(10, teacherPanel, gridPanels);
    expect(plan.startsAtTeachers).toBe(false);
    expect(plan.usedPanels.map((p) => p.panel)).toEqual([1, 2]);
    expect(plan.distribution.perPanel).toEqual([6, 4]);
    expect(plan.distribution.overflow).toBe(0);
  });

  it('ровно влезли в панели 1-2 → у учителей не начинаем', () => {
    const plan = planFloatingGrid(12, teacherPanel, gridPanels);
    expect(plan.startsAtTeachers).toBe(false);
    expect(plan.distribution.perPanel).toEqual([6, 6]);
  });

  it('много учеников → сетка начинается у учителей (panel_0)', () => {
    const plan = planFloatingGrid(16, teacherPanel, gridPanels);
    expect(plan.startsAtTeachers).toBe(true);
    expect(plan.usedPanels.map((p) => p.panel)).toEqual([0, 1, 2]);
    // panel_0 заполняется первым (слева): 6 + 6 + 4
    expect(plan.distribution.perPanel).toEqual([6, 6, 4]);
    expect(plan.distribution.overflow).toBe(0);
  });

  it('переполнение даже с панелью учителей → overflow в warning', () => {
    const plan = planFloatingGrid(20, teacherPanel, gridPanels);
    expect(plan.startsAtTeachers).toBe(true);
    expect(plan.distribution.placed).toBe(18);
    expect(plan.distribution.overflow).toBe(2);
  });

  it('панель учителей не годится под сетку (capacity 0) → startsAtTeachers false', () => {
    const plan = planFloatingGrid(20, { panel: 0, capacity: 0 }, gridPanels);
    // подключили panel_0, но мест там нет — флаг не поднимаем
    expect(plan.startsAtTeachers).toBe(false);
    expect(plan.distribution.overflow).toBe(8);
  });
});
