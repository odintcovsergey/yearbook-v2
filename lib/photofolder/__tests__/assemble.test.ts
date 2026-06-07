import { describe, it, expect } from 'vitest';
import type { HeadTeacher, Student, Subject } from '../../album-builder/types';
import { assemblePhotofolder } from '../assemble';
import type { PhotofolderInput, PhotofolderMaster } from '../types';

// Сборка фотопапки на синтетических мастерах (реального IDML пока нет).

function student(name: string, portrait: string | null): Student {
  return { full_name: name, quote: '', portrait, friend_photos: [] };
}

const head: HeadTeacher = {
  name: 'Иванова И.И.',
  role: 'Классный руководитель',
  text: 'Дорогие дети…',
  photo: 'head.jpg',
};

const subjects: Subject[] = [
  { name: 'Петров П.П.', role: 'Математика', photo: 'subj1.jpg' },
];

// Разворот 1: панели 0-1 — групповые, панель 2 — обложка папки.
const master1: PhotofolderMaster = {
  id: 'm1',
  name: 'PF-Outer',
  spread_index: 0,
  slots: [
    { label: 'collagephoto_1', panel: 0 },
    { label: 'collagephoto_2', panel: 0 },
    { label: 'collagephoto_3', panel: 1 },
    { label: 'collagephoto_4', panel: 1 },
    { label: 'cover_portrait', panel: 2 },
    { label: 'cover_student_name', panel: 2 },
    { label: 'cover_title', panel: 2 },
    { label: 'cover_school_name', panel: 2 },
    { label: 'cover_common_photo', panel: 2 },
  ],
};

// Разворот 2: панель 0 — учителя + 6 ученических слотов (вариант с плавающей
// сеткой), панели 1-2 — по 6 ученических слотов. Ёмкость сетки: 0→6, 1→6, 2→6.
function makeMaster2(): PhotofolderMaster {
  const slots = [
    { label: 'headteacherphoto', panel: 0 },
    { label: 'headteachername', panel: 0 },
    { label: 'headteacherrole', panel: 0 },
    { label: 'headtextframe', panel: 0 },
    { label: 'teacherphoto_1', panel: 0 },
    { label: 'teachername_1', panel: 0 },
    { label: 'teacherrole_1', panel: 0 },
  ];
  // studentportrait_1..18 + studentname_1..18 по 6 на панель 0,1,2.
  for (let n = 1; n <= 18; n++) {
    const panel = Math.floor((n - 1) / 6); // 1-6→0, 7-12→1, 13-18→2
    slots.push({ label: `studentportrait_${n}`, panel });
    slots.push({ label: `studentname_${n}`, panel });
  }
  return { id: 'm2', name: 'PF-Inner', spread_index: 1, slots };
}

function makeInput(students: Student[]): PhotofolderInput {
  return {
    mode: 'portrait_personal',
    masters: [master1, makeMaster2()],
    head_teacher: head,
    subjects,
    students,
    group_photos: ['g1.jpg', 'g2.jpg', 'g3.jpg'],
    shared: {
      title: 'Выпуск 2026',
      school_name: 'Школа №1',
      city: 'Москва',
      year: '2026',
      classes: '11А',
      cover_common_photo_url: 'common.jpg',
    },
  };
}

describe('assemblePhotofolder — разворот 1 (групповые + обложка)', () => {
  it('групповые фото раскладываются по слотам слева направо', () => {
    const res = assemblePhotofolder(makeInput([student('A', 'a.jpg')]));
    const s1 = res.instances[0].spreads[0].data;
    expect(s1.collagephoto_1).toBe('g1.jpg');
    expect(s1.collagephoto_2).toBe('g2.jpg');
    expect(s1.collagephoto_3).toBe('g3.jpg');
    expect(s1.collagephoto_4).toBeNull(); // фото кончились
  });

  it('общие поля обложки заполнены, портрет и ФИО — персональные', () => {
    const res = assemblePhotofolder(makeInput([student('Сидоров С.', 'sid.jpg')]));
    const s1 = res.instances[0].spreads[0].data;
    expect(s1.cover_title).toBe('Выпуск 2026');
    expect(s1.cover_school_name).toBe('Школа №1');
    expect(s1.cover_common_photo).toBe('common.jpg');
    expect(s1.cover_portrait).toBe('sid.jpg'); // персональный
    expect(s1.cover_student_name).toBe('Сидоров С.'); // персональное
  });

  it('по папке на ученика: портрет на обложке у каждого свой', () => {
    const res = assemblePhotofolder(
      makeInput([student('A', 'a.jpg'), student('B', 'b.jpg')]),
    );
    expect(res.instances).toHaveLength(2);
    expect(res.instances[0].spreads[0].data.cover_portrait).toBe('a.jpg');
    expect(res.instances[1].spreads[0].data.cover_portrait).toBe('b.jpg');
    // разворот 2 общий — один и тот же объект на всех
    expect(res.instances[0].spreads[1]).toBe(res.instances[1].spreads[1]);
  });
});

describe('assemblePhotofolder — разворот 2 (учителя + плавающая сетка)', () => {
  it('классрук и предметник заполнены на панели учителей', () => {
    const res = assemblePhotofolder(makeInput([student('A', 'a.jpg')]));
    const s2 = res.instances[0].spreads[1].data;
    expect(s2.headteacherphoto).toBe('head.jpg');
    expect(s2.headteachername).toBe('Иванова И.И.');
    expect(s2.headtextframe).toBe('Дорогие дети…');
    expect(s2.teacherphoto_1).toBe('subj1.jpg');
    expect(s2.teachername_1).toBe('Петров П.П.');
  });

  it('мало учеников (10) → сетка со 2-й панели, у учителей ученики пустые', () => {
    const students = Array.from({ length: 10 }, (_, i) =>
      student(`S${i + 1}`, `p${i + 1}.jpg`),
    );
    const res = assemblePhotofolder(makeInput(students));
    const s2 = res.instances[0].spreads[1].data;
    // панель 0 (учителя) — ученические слоты пустые
    expect(s2.studentportrait_1).toBeNull();
    expect(s2.studentportrait_6).toBeNull();
    // панель 1 (7..12) — первые 6 учеников
    expect(s2.studentportrait_7).toBe('p1.jpg');
    expect(s2.studentportrait_12).toBe('p6.jpg');
    expect(s2.studentname_7).toBe('S1');
    // панель 2 (13..18) — оставшиеся 4, дальше пусто
    expect(s2.studentportrait_13).toBe('p7.jpg');
    expect(s2.studentportrait_16).toBe('p10.jpg');
    expect(s2.studentportrait_17).toBeNull();
    expect(res.warnings.find((w) => w.code === 'students_overflow')).toBeUndefined();
  });

  it('много учеников (16) → сетка начинается у учителей (panel_0)', () => {
    const students = Array.from({ length: 16 }, (_, i) =>
      student(`S${i + 1}`, `p${i + 1}.jpg`),
    );
    const res = assemblePhotofolder(makeInput(students));
    const s2 = res.instances[0].spreads[1].data;
    // панель 0 заполняется первой
    expect(s2.studentportrait_1).toBe('p1.jpg');
    expect(s2.studentportrait_6).toBe('p6.jpg');
    expect(s2.studentportrait_7).toBe('p7.jpg'); // панель 1
    expect(s2.studentportrait_13).toBe('p13.jpg'); // панель 2
    expect(s2.studentportrait_16).toBe('p16.jpg');
    expect(s2.studentportrait_17).toBeNull();
  });

  it('переполнение (20) → warning students_overflow', () => {
    const students = Array.from({ length: 20 }, (_, i) =>
      student(`S${i + 1}`, `p${i + 1}.jpg`),
    );
    const res = assemblePhotofolder(makeInput(students));
    const w = res.warnings.find((x) => x.code === 'students_overflow');
    expect(w).toBeDefined();
    expect(w!.detail).toContain('2');
  });
});

describe('assemblePhotofolder — крайние случаи', () => {
  it('нет учеников → одна общая папка, портрет на обложке пустой', () => {
    const res = assemblePhotofolder(makeInput([]));
    expect(res.instances).toHaveLength(1);
    expect(res.instances[0].child_id).toBeNull();
    expect(res.instances[0].spreads[0].data.cover_portrait).toBeNull();
    expect(res.warnings.find((w) => w.code === 'students_empty')).toBeDefined();
  });

  it('нет классрука → warning no_head_teacher', () => {
    const input = makeInput([student('A', 'a.jpg')]);
    input.head_teacher = null;
    const res = assemblePhotofolder(input);
    expect(res.warnings.find((w) => w.code === 'no_head_teacher')).toBeDefined();
    expect(res.instances[0].spreads[1].data.headteacherphoto).toBeNull();
  });

  it('нет мастера разворота 2 → warning master_missing, разворот пустой', () => {
    const input = makeInput([student('A', 'a.jpg')]);
    input.masters = [master1]; // только разворот 1
    const res = assemblePhotofolder(input);
    expect(res.warnings.filter((w) => w.code === 'master_missing')).toHaveLength(1);
    expect(res.instances[0].spreads[1].master_id).toBeNull();
    expect(res.instances[0].spreads[1].data).toEqual({});
  });

  it('full_personal в этой итерации ведёт себя как базовый (каркас)', () => {
    const input = makeInput([student('A', 'a.jpg'), student('B', 'b.jpg')]);
    input.mode = 'full_personal';
    const res = assemblePhotofolder(input);
    expect(res.mode).toBe('full_personal');
    expect(res.instances).toHaveLength(2);
    expect(res.instances[0].spreads[0].data.cover_portrait).toBe('a.jpg');
  });
});
