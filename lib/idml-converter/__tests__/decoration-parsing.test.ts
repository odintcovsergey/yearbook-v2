/**
 * Этап 2а ТЗ привязанного декора (docs/tz-attached-decor.md, Часть 1).
 *
 * Проверяет на РЕАЛЬНОМ образце дизайнера (docs/для теста.idml) что парсер:
 *   - распознаёт метки `<base>__under` / `<base>__over` как декор;
 *   - НЕ превращает декор-прямоугольник в фиктивный фото-слот;
 *   - достаёт встроенную (embedded) PNG-картинку из IDML;
 *   - считает offset декора относительно базового слота;
 *   - не ломает обычные слоты (фото/текст/база) на той же странице.
 *
 * Образец содержит помеченный комплект «зелёный воспитатель»:
 *   teacherphoto_1            (Rectangle, фото-слот)
 *   teacherphoto_1__over      (Rectangle с embedded PNG — рамка поверх фото)
 *   teachername_1             (TextFrame, имя)
 *   teachername_1__under      (Rectangle с embedded PNG — ленточка под именем)
 * «Голубой воспитатель» намеренно без меток → его ленточки пропускаются.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIdml } from '../parse';
import type { DecorationPlaceholder, Placeholder } from '../types';

const SAMPLE_PATH = join(process.cwd(), 'docs', 'для теста.idml');

function allPlaceholders(
  set: Awaited<ReturnType<typeof parseIdml>>,
): Placeholder[] {
  return set.spread_templates.flatMap((s) => s.placeholders);
}

function findByLabel(phs: Placeholder[], label: string): Placeholder | undefined {
  return phs.find((p) => p.label === label);
}

describe('decoration parsing (Этап 2а)', () => {
  it('распознаёт __over / __under как декор с embedded PNG', async () => {
    const bytes = readFileSync(SAMPLE_PATH);
    const set = await parseIdml(bytes);
    const phs = allPlaceholders(set);

    const over = findByLabel(phs, 'teacherphoto_1__over');
    expect(over, 'teacherphoto_1__over должен быть распознан').toBeDefined();
    expect(over!.type).toBe('decoration');

    const overDecor = over as DecorationPlaceholder;
    expect(overDecor.layer).toBe('over');
    expect(overDecor.attached_to).toBe('teacherphoto_1');
    expect(overDecor._embedded).toBeDefined();
    expect(overDecor._embedded!.format).toBe('png');
    expect(overDecor._embedded!.base64.length).toBeGreaterThan(1000);
    // url пустой до Этапа 2б (загрузка в storage).
    expect(overDecor.url).toBe('');

    const under = findByLabel(phs, 'teachername_1__under');
    expect(under, 'teachername_1__under должен быть распознан').toBeDefined();
    const underDecor = under as DecorationPlaceholder;
    expect(underDecor.type).toBe('decoration');
    expect(underDecor.layer).toBe('under');
    expect(underDecor.attached_to).toBe('teachername_1');
    expect(underDecor._embedded!.format).toBe('png');
  });

  it('считает offset декора относительно базового слота', async () => {
    const set = await parseIdml(readFileSync(SAMPLE_PATH));
    const phs = allPlaceholders(set);

    const over = findByLabel(phs, 'teacherphoto_1__over') as DecorationPlaceholder;
    const base = findByLabel(phs, 'teacherphoto_1');
    expect(base, 'базовый слот teacherphoto_1 должен существовать').toBeDefined();

    // offset = позиция декора − позиция базы (по обеим осям).
    expect(over.offset_x_mm).toBeCloseTo(over.x_mm - base!.x_mm, 5);
    expect(over.offset_y_mm).toBeCloseTo(over.y_mm - base!.y_mm, 5);
    // offset конечен (не NaN/Infinity).
    expect(Number.isFinite(over.offset_x_mm)).toBe(true);
    expect(Number.isFinite(over.offset_y_mm)).toBe(true);
  });

  it('не превращает декор-прямоугольник в фото-слот и не ломает базу', async () => {
    const set = await parseIdml(readFileSync(SAMPLE_PATH));
    const phs = allPlaceholders(set);

    // База teacherphoto_1 — это photo, а НЕ decoration.
    const base = findByLabel(phs, 'teacherphoto_1');
    expect(base!.type).toBe('photo');

    // Среди фото-слотов не должно быть ни одного с суффиксом __over/__under.
    const photoDecorLeak = phs.filter(
      (p) => p.type === 'photo' && /__(over|under)$/.test(p.label),
    );
    expect(photoDecorLeak).toHaveLength(0);

    // Имя teachername_1 остаётся живым текстом.
    const name = findByLabel(phs, 'teachername_1');
    expect(name!.type).toBe('text');
  });
});
