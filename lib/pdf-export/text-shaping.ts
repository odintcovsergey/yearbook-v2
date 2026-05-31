/**
 * Text shaping (фаза 3.5).
 *
 * Полноценный рендер текстовых плейсхолдеров: line wrap по словам,
 * auto_fit с уменьшением font_size до min_size_pt, vertical_align
 * (top/middle/bottom), align (left/center/right/justify), multi-line
 * раскладка.
 *
 * До 3.5: drawTextSimple в pipeline.ts рисовал текст плоско на
 * font_size_pt без переносов и без вертикального выравнивания. Это
 * работало для коротких имён, но длинные цитаты ("Школа — лучшие
 * годы...") выезжали за рамку.
 *
 * Алгоритм shapeText:
 * 1. Если auto_fit=true: пытаемся уменьшить font_size до min_size_pt
 *    чтобы текст влез в ширину одной строкой. Step 0.5 pt (компромисс
 *    между точностью и итерациями).
 * 2. На финальном font_size делаем word-by-word wrap: добавляем слова
 *    в строку пока ширина не превысит max_width, потом переход.
 * 3. Если суммарная высота строк (lines_count × line_height) превышает
 *    placeholder.height_mm — warning text_overflow и truncate.
 *
 * line_height = font_size × 1.2 (стандарт для большинства шрифтов).
 * ascent ≈ font_size × 0.8, descent ≈ font_size × 0.2 (приблизительно).
 *
 * Justify реализован простой алгоритм: для строк > 1 слова распределяем
 * избыточный пробел между словами равномерно. Последняя строка
 * параграфа не выравнивается (визуально неправильно). В нашем use case
 * (имена и цитаты) justify используется редко, поэтому не делаем
 * сложного определения "последняя строка" — все non-single-word строки
 * justify'им.
 */

import { PDFPage, PDFFont, rgb, degrees } from 'pdf-lib';
import { hexToRgb01, placeholderToPdfBox } from './units';
import type { PageBoxes, PdfWarning } from './types';
import type { TextPlaceholder } from '@/lib/album-builder/types';

/** Множитель line-height относительно font_size_pt. */
const LINE_HEIGHT_RATIO = 1.2;

/** Доля ascent от font_size_pt (для baseline calculation). */
const ASCENT_RATIO = 0.8;

/** Доля descent от font_size_pt (для отступа descender'ов в rotated text). */
const DESCENT_RATIO = 0.2;

/** Шаг auto_fit при уменьшении font_size, в pt. */
const AUTO_FIT_STEP_PT = 0.5;

/**
 * Результат shape'а текста: финальный font_size + список строк.
 */
type ShapedText = {
  lines: string[];
  font_size_pt: number;
};

/**
 * Главная функция: shape + рендер текстового placeholder'а.
 *
 * Если text пустой — ничего не рисуется.
 * Если ничего не помещается даже на min_size_pt — рендерим всё с
 * warning text_overflow (партнёр увидит косяк и поправит в редакторе).
 */
export function drawTextShaped(
  page: PDFPage,
  ph: TextPlaceholder,
  text: string,
  font: PDFFont,
  pageBoxes: PageBoxes,
  warnings: PdfWarning[],
  spread_index: number,
  // Р.3 — override стиля. Default (1, null) → используется
  // placeholder.font_size_pt и placeholder.color (regression-safe).
  fontSizeMult: number = 1,
  colorOverride: string | null = null
): void {
  if (!text) return;

  const box = placeholderToPdfBox(
    ph.x_mm,
    ph.y_mm,
    ph.width_mm,
    ph.height_mm,
    pageBoxes
  );

  // Эффективные width/height для shape: для rotated text (rotation_deg ±90)
  // длинная сторона placeholder становится текстовой "шириной" (по которой
  // wrap), а короткая — "высотой" (по которой проверяется overflow).
  // Без этого фикса (3.9.2.3) "Учитель физики" в rotated 18×130mm placeholder
  // wrap'ался на 53pt узкой стороны, делясь на "Учитель"/"физики".
  const idml_rotation_deg_for_shape = ph.rotation_deg ?? 0;
  const isRotated = idml_rotation_deg_for_shape === 90 || idml_rotation_deg_for_shape === -90;
  const max_width_pt = isRotated ? box.height_pt : box.width_pt;
  const max_height_pt = isRotated ? box.width_pt : box.height_pt;

  // Р.3 — применяем мультипликатор к font_size и min_size перед shape'ом.
  // Если auto_fit=true и текст не влезает, shapeText продолжит уменьшать
  // от уже scaled значения вплоть до min_size_pt * fontSizeMult.
  const effective_base_size_pt = ph.font_size_pt * fontSizeMult;
  const effective_min_size_pt = (ph.min_size_pt ?? ph.font_size_pt) * fontSizeMult;

  // Шейпим: подбираем font_size и разбиваем на строки.
  const shaped = shapeText(
    text,
    font,
    effective_base_size_pt,
    effective_min_size_pt,
    ph.auto_fit,
    max_width_pt
  );

  // Проверяем не выходит ли блок строк за высоту placeholder'а.
  const line_height_pt = shaped.font_size_pt * LINE_HEIGHT_RATIO;
  const total_text_height_pt = shaped.lines.length * line_height_pt;
  let lines = shaped.lines;
  if (total_text_height_pt > max_height_pt + 0.5) {
    const max_lines = Math.max(1, Math.floor(max_height_pt / line_height_pt));
    if (lines.length > max_lines) {
      warnings.push({
        code: 'text_overflow',
        detail: `${ph.label}: текст не помещается, обрезано ${lines.length - max_lines} строк (${shaped.font_size_pt}pt, ${lines.length} линий × ${line_height_pt.toFixed(1)}pt > ${max_height_pt.toFixed(1)}pt)`,
        context: { spread_index, label: ph.label },
      });
      lines = lines.slice(0, max_lines);
    }
  }

  // Считаем base position (baseline первой строки) с учётом vertical_align
  // и rotation_deg.
  //
  // Эталон проверки: эталон InDesign-разворота показывает что текст роли
  // учителя вдоль вертикальной стороны фото (rotation=-90 в IDML и в БД)
  // должен иметь:
  //   - reading top-to-bottom (первая буква наверху)
  //   - top of letters facing right (к фото)
  //
  // pdf-lib `rotate: degrees(-90)` даёт CW 90° rotation вокруг baseline:
  //   - исходное +x (text direction) → -y (вниз в PDF Y-up)
  //   - исходное +y (above baseline = top of letter) → +x (вправо)
  //   ✓ соответствует эталону
  //
  // Ошибка в 3.9.2.1 — инверсия знака — была неправильной. PDF rotation
  // совпадает с IDML rotation, без преобразования (потому что drawText
  // в pdf-lib интерпретирует angle относительно baseline после Y-flip
  // самой системы).
  //
  // Для idml=-90 baseline должна быть:
  //   - baseline_x = box.x + descent (descender уходит влево, нужен отступ)
  //   - baseline_y = box.y + box.height (верхний край placeholder в PDF)
  //   - new line: visual right of previous = +x (line_step_x = +line_height)
  //
  // Для idml=+90 (CCW 90°) — зеркально:
  //   - baseline_x = box.x + box.width − descent
  //   - baseline_y = box.y (нижний край в PDF)
  //   - new line: -x (line_step_x = -line_height)
  const ascent_pt = shaped.font_size_pt * ASCENT_RATIO;
  const descent_pt = shaped.font_size_pt * DESCENT_RATIO;
  const block_height_pt = lines.length * line_height_pt;
  const idml_rotation_deg = ph.rotation_deg ?? 0;

  let first_baseline_x_pt = box.x_pt;
  let first_baseline_y_pt: number;
  let line_step_x_pt = 0;
  let line_step_y_pt = -line_height_pt;

  if (idml_rotation_deg === -90) {
    // CW 90°: text идёт вниз, top of letters facing right
    first_baseline_x_pt = box.x_pt + descent_pt;
    first_baseline_y_pt = box.y_pt + box.height_pt;
    line_step_x_pt = line_height_pt;
    line_step_y_pt = 0;
  } else if (idml_rotation_deg === 90) {
    // CCW 90°: text идёт вверх, top of letters facing left
    first_baseline_x_pt = box.x_pt + box.width_pt - descent_pt;
    first_baseline_y_pt = box.y_pt;
    line_step_x_pt = -line_height_pt;
    line_step_y_pt = 0;
  } else {
    // rotation = 0: vertical_align релевантен
    switch (ph.vertical_align) {
      case 'top':
        first_baseline_y_pt = box.y_pt + box.height_pt - ascent_pt;
        break;
      case 'middle':
        first_baseline_y_pt =
          box.y_pt + box.height_pt / 2 + block_height_pt / 2 - ascent_pt;
        break;
      case 'bottom':
        first_baseline_y_pt = box.y_pt + block_height_pt - ascent_pt;
        break;
      default:
        first_baseline_y_pt = box.y_pt + box.height_pt - ascent_pt;
    }
  }

  // effective_max_width_pt в drawLine — это та же rotation-aware ширина
  // что в shapeText (для align center/right/justify).
  const effective_max_width_pt = max_width_pt;

  // Рисуем каждую строку. rotation передаётся в drawLine как есть
  // (idml_rotation_deg) — без инверсии.
  // Р.3 — override цвета имеет приоритет, иначе placeholder.color.
  const color = hexToRgb01(colorOverride ?? ph.color);
  // Часть 3 ТЗ: обводка текста (приблизительно). Поля опциональны — если не
  // заданы, stroke=null и рендер идентичен прежнему (regression-safe).
  const stroke =
    ph.text_stroke_color && ph.text_stroke_width_pt && ph.text_stroke_width_pt > 0
      ? {
          color: hexToRgb01(ph.text_stroke_color),
          widthPt: ph.text_stroke_width_pt,
        }
      : null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const baseline_x_pt = first_baseline_x_pt + i * line_step_x_pt;
    const baseline_y_pt = first_baseline_y_pt + i * line_step_y_pt;
    const is_last_line = i === lines.length - 1;
    drawLine(
      page,
      line,
      font,
      shaped.font_size_pt,
      color,
      baseline_x_pt,
      baseline_y_pt,
      effective_max_width_pt,
      ph.align,
      idml_rotation_deg,
      is_last_line,
      stroke
    );
  }
}

/**
 * Подбор font_size + разбиение на строки.
 *
 * Алгоритм:
 * 1. Если auto_fit=false — сразу wrap на base_size.
 * 2. Если auto_fit=true:
 *    - Пробуем нарисовать ВСЕ строки на base_size с wrap'ом.
 *    - Если влезает в одну строку — отлично, single-line.
 *    - Иначе уменьшаем font_size до min_size_pt пытаясь сделать
 *      single-line. Если single-line на min_size — берём его.
 *    - Если даже на min_size single-line не получается — wrap'аем
 *      на min_size (потом если строки тоже выезжают — text_overflow
 *      warning в caller'е).
 *
 * Возвращает финальный font_size + lines.
 */
function shapeText(
  text: string,
  font: PDFFont,
  base_size_pt: number,
  min_size_pt: number,
  auto_fit: boolean,
  max_width_pt: number
): ShapedText {
  // Если auto_fit=false — wrap на base_size без подбора.
  if (!auto_fit || min_size_pt >= base_size_pt) {
    return {
      lines: wrapWords(text, font, base_size_pt, max_width_pt),
      font_size_pt: base_size_pt,
    };
  }

  // Auto_fit: пытаемся подобрать размер чтобы текст влез в ОДНУ строку.
  // Если на base_size одна строка — отлично.
  const baseWidth = font.widthOfTextAtSize(text, base_size_pt);
  if (baseWidth <= max_width_pt) {
    return { lines: [text], font_size_pt: base_size_pt };
  }

  // Уменьшаем размер пока не помещается single-line или не достигнут min.
  for (
    let size = base_size_pt - AUTO_FIT_STEP_PT;
    size >= min_size_pt;
    size -= AUTO_FIT_STEP_PT
  ) {
    const w = font.widthOfTextAtSize(text, size);
    if (w <= max_width_pt) {
      return { lines: [text], font_size_pt: size };
    }
  }

  // На min_size single-line не получилось — wrap на min_size.
  return {
    lines: wrapWords(text, font, min_size_pt, max_width_pt),
    font_size_pt: min_size_pt,
  };
}

/**
 * Word-by-word wrap. Возвращает массив строк.
 *
 * Если одно слово длиннее max_width — оно остаётся как есть (вылезет).
 * Это редкий кейс для нашего русского текста (имена, короткие фразы,
 * цитаты); в фазе 3.X можно добавить character-level wrap для
 * экстремальных случаев.
 */
function wrapWords(
  text: string,
  font: PDFFont,
  size_pt: number,
  max_width_pt: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const w = font.widthOfTextAtSize(test, size_pt);
    if (w <= max_width_pt) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Рендер одной строки с поддержкой align (left/center/right/justify).
 *
 * - left:    text начинается с x_pt
 * - center:  text по центру (x_pt + (max_width - text_width)/2)
 * - right:   text прижат вправо (x_pt + max_width - text_width)
 * - justify: распределяем пробелы между словами; последняя строка
 *            параграфа = left (визуально естественно)
 */
/**
 * Часть 3 ТЗ docs/tz-attached-decor.md: приблизительная обводка текста в PDF.
 *
 * pdf-lib не поддерживает stroke глифов нативно, поэтому имитируем: рисуем
 * текст обводочным цветом 8 раз со смещением по кругу (радиус = толщина
 * обводки), а основной текст — сверху в вызывающем коде. Свечение (glow) в
 * PDF не делаем (Konva-превью его показывает; ТЗ допускает «приблизительно /
 * пропустить» для PDF — тень глифов в pdf-lib потребовала бы растеризации).
 */
function drawTextStroke(
  page: PDFPage,
  text: string,
  opts: {
    x_pt: number;
    y_pt: number;
    size_pt: number;
    font: PDFFont;
    rotation_deg: number;
    strokeColor: { r: number; g: number; b: number };
    strokeWidthPt: number;
  },
): void {
  const r = opts.strokeWidthPt;
  const strokeRgb = rgb(opts.strokeColor.r, opts.strokeColor.g, opts.strokeColor.b);
  // 8 направлений (оси + диагонали /√2) — равномерный контур по краю глифов.
  const d = r / Math.SQRT2;
  const offsets: Array<[number, number]> = [
    [r, 0], [-r, 0], [0, r], [0, -r],
    [d, d], [d, -d], [-d, d], [-d, -d],
  ];
  for (const [dx, dy] of offsets) {
    page.drawText(text, {
      x: opts.x_pt + dx,
      y: opts.y_pt + dy,
      size: opts.size_pt,
      font: opts.font,
      color: strokeRgb,
      rotate: degrees(opts.rotation_deg),
    });
  }
}

function drawLine(
  page: PDFPage,
  line: string,
  font: PDFFont,
  size_pt: number,
  color: { r: number; g: number; b: number },
  x_pt: number,
  baseline_y_pt: number,
  max_width_pt: number,
  align: TextPlaceholder['align'],
  rotation_deg: number,
  is_last_line: boolean,
  // Часть 3 ТЗ: обводка (опционально). null → без обводки (старое поведение).
  stroke: { color: { r: number; g: number; b: number }; widthPt: number } | null = null,
): void {
  const text_width = font.widthOfTextAtSize(line, size_pt);
  const colorRgb = rgb(color.r, color.g, color.b);
  // Хелпер: обводка (под текстом) + основной глиф поверх.
  const drawGlyphs = (txt: string, gx: number, gy: number): void => {
    if (stroke) {
      drawTextStroke(page, txt, {
        x_pt: gx,
        y_pt: gy,
        size_pt,
        font,
        rotation_deg,
        strokeColor: stroke.color,
        strokeWidthPt: stroke.widthPt,
      });
    }
    page.drawText(txt, {
      x: gx,
      y: gy,
      size: size_pt,
      font,
      color: colorRgb,
      rotate: degrees(rotation_deg),
    });
  };

  if (align === 'justify' && !is_last_line) {
    // Justify: распределяем избыточное пространство между словами.
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
      // Одно слово или пусто — не justify, рисуем как left
      drawGlyphs(line, x_pt, baseline_y_pt);
      return;
    }

    // Считаем суммарную ширину слов БЕЗ пробелов, потом распределяем
    // оставшееся пространство по N-1 межсловным разрывам.
    const total_words_width = words.reduce(
      (acc, w) => acc + font.widthOfTextAtSize(w, size_pt),
      0
    );
    const total_gap_width = max_width_pt - total_words_width;
    const gap = total_gap_width / (words.length - 1);

    let cursor_x_pt = x_pt;
    for (let i = 0; i < words.length; i++) {
      drawGlyphs(words[i], cursor_x_pt, baseline_y_pt);
      cursor_x_pt += font.widthOfTextAtSize(words[i], size_pt) + gap;
    }
    return;
  }

  // Left / center / right / justify-last-line
  let final_x_pt: number;
  if (align === 'center') {
    final_x_pt = x_pt + (max_width_pt - text_width) / 2;
  } else if (align === 'right') {
    final_x_pt = x_pt + max_width_pt - text_width;
  } else {
    // left или justify-last-line
    final_x_pt = x_pt;
  }

  drawGlyphs(line, final_x_pt, baseline_y_pt);
}

// Re-export для использования напрямую из других модулей если нужно.
export { shapeText, wrapWords };
