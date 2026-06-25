/**
 * Сверка пикселей при типографском экспорте (предупреждение, НЕ источник истины).
 *
 * Расчёт размера файла остаётся мм×dpi. Здесь только СВЕРКА: совпадает ли размер
 * разворота, который мы реально отдаём, с эталоном px, введённым типографией
 * (`PrinterFormat.spread_*_px`). Важно для попадания пиксель-в-пиксель у
 * типографий вроде «Фабрики Фотокниги».
 *
 * Чистая функция — тестируется без рендера.
 */
import type { AcceptMode, PrinterFormat } from '../printers/types';
import type { PdfWarning } from './types';

/** Допуск сверки (на округление ceil/round). */
const PX_TOLERANCE = 1;

/**
 * Вернёт warning, если размер файла-разворота (мм×dpi) расходится с эталоном px
 * формата; иначе null. Пропуски (null без warning):
 *  - формат не выбран / адаптация не применилась (страница не = формату);
 *  - режим приёма НЕ 'spread' (у формата только эталон разворота; per-page —
 *    можно добавить позже);
 *  - эталонные px не заданы (0/пусто, как у «Булгака») — сверять нечего.
 *
 * Разворот = 2 страницы + вылеты с обеих сторон (см. renderSpread в pipeline.ts):
 *   media_w = 2×page_w + 2×bleed, media_h = page_h + 2×bleed; px = мм × dpi / 25.4.
 */
export function checkFormatPx(opts: {
  pageWidthMm: number;
  pageHeightMm: number;
  bleedMm: number;
  dpi: number;
  acceptMode: AcceptMode;
  /** Применилась ли адаптация под формат (status='adapted'). */
  adapted: boolean;
  format: PrinterFormat | null;
}): PdfWarning | null {
  const tf = opts.format;
  if (!tf || !opts.adapted || opts.acceptMode !== 'spread') return null;
  if (!(tf.spread_w_px > 0) || !(tf.spread_h_px > 0)) return null;

  const expectedW = Math.round(((opts.pageWidthMm * 2 + opts.bleedMm * 2) * opts.dpi) / 25.4);
  const expectedH = Math.round(((opts.pageHeightMm + opts.bleedMm * 2) * opts.dpi) / 25.4);

  if (
    Math.abs(expectedW - tf.spread_w_px) <= PX_TOLERANCE &&
    Math.abs(expectedH - tf.spread_h_px) <= PX_TOLERANCE
  ) {
    return null;
  }

  return {
    code: 'format_px_mismatch',
    detail:
      `Размер не совпадает с эталоном типографии: разворот ожидается ` +
      `${tf.spread_w_px}×${tf.spread_h_px}px, а по заданным мм и ${opts.dpi} dpi ` +
      `выходит ${expectedW}×${expectedH}px. Проверьте размеры в мм или DPI в настройках формата.`,
    context: { format: tf.name },
  };
}
