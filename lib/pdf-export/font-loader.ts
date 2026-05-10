/**
 * Загрузка шрифтов в PDFDocument + резолвер font_family/weight → PDFFont.
 *
 * Контекст: после идентификации шрифтов в "Плотные Мастер Белый" макете
 * (Type→Find Font, 5 шрифтов) у нас 3 семейства:
 *
 * - Noto Serif (regular + bold) — заголовки, имена
 * - Open Sans (regular + italic) — описания, цитаты
 * - Slimamif Medium — декоративные надписи (handwritten/art-nouveau)
 *
 * Все 3 семейства open-source с полной кириллицей, файлы лежат в
 * `public/fonts/` и embed'ятся в PDFDocument через pdf-lib с
 * `subset: true` (только использованные глифы, ~50 KB на семью).
 *
 * Парсер IDML извлекает font_family как строку («Noto Serif»,
 * «Open Sans», «Slimamif») и font_weight как enum из 4 значений
 * (`regular | bold | medium | light`). FontRegistry.resolve()
 * маршрутизирует пару (family, weight) на один из 5 PDFFont
 * экземпляров.
 *
 * Italic парсер сейчас не различает — Open Sans Italic в БД не
 * фигурирует (см. SQL-проверка перед стартом 3.2). Файл
 * OpenSans-Italic.ttf загружен «на будущее» — когда парсер начнёт
 * различать FontStyle="Italic", резолвер уже готов.
 *
 * См. docs/phase-3-spec.md §4.2.
 */

import path from 'path';
import { promises as fs } from 'fs';
import type { PDFDocument, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PdfWarning } from './types';

/**
 * Канонические ключи зарегистрированных шрифтов.
 * Соответствуют файлам в public/fonts/.
 */
type FontKey =
  | 'noto-serif-regular'
  | 'noto-serif-bold'
  | 'open-sans-regular'
  | 'open-sans-italic'
  | 'slimamif-medium';

const FONT_FILES: Record<FontKey, string> = {
  'noto-serif-regular': 'NotoSerif-Regular.ttf',
  'noto-serif-bold': 'NotoSerif-Bold.ttf',
  'open-sans-regular': 'OpenSans-Regular.ttf',
  'open-sans-italic': 'OpenSans-Italic.ttf',
  'slimamif-medium': 'Slimamif-Medium.ttf',
};

export type FontRegistry = {
  /**
   * Резолв (font_family, font_weight) → PDFFont.
   *
   * При отсутствии соответствия — fallback на noto-serif-regular
   * + warning 'font_not_found'. Фаза 3 рассчитывает только на
   * 3 семейства из макета; неизвестные фолбачатся без ошибки.
   *
   * @param family — IDML font_family (case-insensitive lookup)
   * @param weight — IDML font_weight ('regular' | 'bold' | 'medium' | 'light')
   * @param italic — true если placeholder italic (фаза 3 не использует)
   */
  resolve(family: string, weight: string, italic: boolean): PDFFont;

  /**
   * Все warning'и накопленные за время резолвинга.
   * Endpoint мерджит их с warnings от photo embed и text shaping.
   */
  warnings: PdfWarning[];
};

/**
 * Загружает все 5 TTF из public/fonts/ в PDFDocument и возвращает
 * FontRegistry. Вызывается один раз на PDF (в начале exportAlbumPdf).
 *
 * Если какой-то TTF файл отсутствует — бросается ошибка (не fallback),
 * потому что это конфигурационная проблема: либо файлы не закоммичены
 * в репо (фаза 3.2 не завершена), либо неправильно собран docker
 * для российского хостинга (июнь 2026). Лучше упасть на старте чем
 * рендерить «слепой» PDF.
 */
export async function loadFonts(pdfDoc: PDFDocument): Promise<FontRegistry> {
  // Регистрируем fontkit — без него pdf-lib умеет embed только своих
  // стандартных Helvetica/TimesRoman/Courier (PDF spec). Для custom TTF
  // обязательна регистрация (см. pdf-lib docs «Embed Font and Measure
  // Text»).
  pdfDoc.registerFontkit(fontkit);

  const fontDir = path.join(process.cwd(), 'public', 'fonts');

  // Загружаем все 5 файлов параллельно.
  const entries = await Promise.all(
    (Object.entries(FONT_FILES) as [FontKey, string][]).map(
      async ([key, filename]) => {
        const filepath = path.join(fontDir, filename);
        const buffer = await fs.readFile(filepath);
        const font = await pdfDoc.embedFont(buffer, { subset: true });
        return [key, font] as const;
      }
    )
  );

  const fonts = Object.fromEntries(entries) as Record<FontKey, PDFFont>;

  const warnings: PdfWarning[] = [];

  return {
    resolve(family: string, weight: string, italic: boolean): PDFFont {
      const key = resolveKey(family, weight, italic);
      const font = fonts[key];
      if (font) return font;
      // Не должно случаться — все ключи покрыты в resolveKey.
      // Но на всякий случай — defensive fallback.
      warnings.push({
        code: 'font_not_found',
        detail: `${family} ${weight}${italic ? ' italic' : ''} → fallback Noto Serif Regular`,
      });
      return fonts['noto-serif-regular'];
    },
    warnings,
  };
}

/**
 * Маппинг (family, weight, italic) → FontKey.
 *
 * Известные семейства: Noto Serif, Open Sans, Slimamif.
 * Неизвестное семейство → noto-serif-regular (с warning'ом, который
 * выставит resolve() через ненайденный ключ).
 *
 * Lowercase сравнение — на случай если парсер вернёт 'noto serif'
 * вместо 'Noto Serif' (idml-recon §6.4 — все label'ы lowercase'ятся,
 * но font_family оригинальный).
 */
function resolveKey(
  family: string,
  weight: string,
  italic: boolean
): FontKey {
  const f = family.toLowerCase().trim();
  const w = weight.toLowerCase().trim();

  if (f.includes('noto serif')) {
    return w === 'bold' ? 'noto-serif-bold' : 'noto-serif-regular';
  }
  if (f.includes('open sans')) {
    return italic ? 'open-sans-italic' : 'open-sans-regular';
  }
  if (f.includes('slimamif')) {
    return 'slimamif-medium';
  }
  // Неизвестное семейство — фолбачим на Noto Serif Regular.
  // resolve() запишет warning 'font_not_found'.
  return 'noto-serif-regular';
}
