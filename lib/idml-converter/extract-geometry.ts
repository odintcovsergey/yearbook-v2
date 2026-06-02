/**
 * Извлечение геометрии плейсхолдеров из MasterSpread XML.
 *
 * Правила парсера — `docs/templates/idml-recon-notes.md` §6.
 * Формула преобразования и эмпирическая проверка — recon-notes §3.
 */

import type { StyleResolver } from './extract-styles';
import type {
  BBox,
  CoverZone,
  CoverZones,
  DecorationPlaceholder,
  EmbeddedImage,
  ItemTransform,
  ParserWarning,
  Placeholder,
  Point,
  SpreadGeometry,
} from './types';
import {
  collectAll,
  findFirst,
  getAttr,
  parseGeometricBounds,
  ptToMm,
} from './xml-utils';

type FrameKind = 'rectangle' | 'oval' | 'textframe';

type FrameRecord = {
  node: Record<string, unknown>;
  kind: FrameKind;
};

// ─── computeSpreadGeometry ────────────────────────────────────────────────

/**
 * По всем `<Page>` внутри MasterSpread считает:
 *   - origin (= leftmost Page.ItemTransform.{tx, ty}, см. recon-notes §6.1),
 *   - размеры разворота в mm,
 *   - x-диапазоны страниц для последующего определения pageIndex фреймов.
 *
 * Возвращает null если pages нет — тогда parse.ts пишет warning и skip'ает мастер.
 */
export function computeSpreadGeometry(
  masterSpread: Record<string, unknown>,
): SpreadGeometry | null {
  const pages = collectAll(masterSpread, 'Page');
  if (pages.length === 0) return null;

  const pageInfos = pages
    .map((p) => {
      const t = parseItemTransform(getAttr(p, 'ItemTransform'));
      const b = parseGeometricBounds(getAttr(p, 'GeometricBounds'));
      if (!t || !b) return null;
      return {
        tx: t.tx,
        ty: t.ty,
        x_min: t.tx + b.x1,
        x_max: t.tx + b.x2,
        y_min: t.ty + b.y1,
        y_max: t.ty + b.y2,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (pageInfos.length === 0) return null;

  pageInfos.sort((a, b) => a.tx - b.tx);
  const leftmost = pageInfos[0];

  const spreadXMin = pageInfos.reduce((m, p) => Math.min(m, p.x_min), Infinity);
  const spreadXMax = pageInfos.reduce((m, p) => Math.max(m, p.x_max), -Infinity);
  const spreadYMin = pageInfos.reduce((m, p) => Math.min(m, p.y_min), Infinity);
  const spreadYMax = pageInfos.reduce((m, p) => Math.max(m, p.y_max), -Infinity);

  return {
    width_mm: ptToMm(spreadXMax - spreadXMin),
    height_mm: ptToMm(spreadYMax - spreadYMin),
    origin: { x: leftmost.tx, y: leftmost.ty },
    is_spread: pageInfos.length === 2,
    pages_x_ranges: pageInfos.map((p) => ({ x_min: p.x_min, x_max: p.x_max })),
  };
}

// ─── Зоны обложки (Этап 2 ТЗ обложки) ─────────────────────────────────────

/**
 * Результат разбора зон обложки.
 * - `zones` — ширины задней/корешка/передней в мм.
 * - `zoneByPageIndex` — зона для каждой страницы по ИСХОДНОМУ индексу
 *   (как в geometry.pages_x_ranges / как возвращает pickPageIndex), чтобы
 *   помечать плейсхолдеры и строить суффиксы _back/_spine/_front.
 */
export type CoverZoneResult = {
  zones: CoverZones;
  zoneByPageIndex: CoverZone[];
};

/**
 * Разбирает обложку-полотно на три зоны из 3-страничного разворота.
 * Конвенция (см. docs/designer-cover-instructions.md): обложка рисуется как
 * ОДИН разворот из 3 страниц — слева задняя, по центру корешок, справа передняя.
 *
 * Сопоставление зон идёт по координате x (слева направо), а НЕ по порядку
 * страниц в XML: самая левая страница = задняя, средняя = корешок, правая =
 * передняя. Возвращает null, если страниц не ровно 3 (тогда parse.ts пишет
 * warning, а cover_zones остаётся null).
 */
export function computeCoverZones(
  pagesXRanges: ReadonlyArray<{ x_min: number; x_max: number }>,
): CoverZoneResult | null {
  if (pagesXRanges.length !== 3) return null;

  const order: CoverZone[] = ['back', 'spine', 'front'];
  // Индексы страниц, отсортированные слева направо по левому краю.
  const byX = pagesXRanges
    .map((r, i) => ({ i, ...r }))
    .sort((a, b) => a.x_min - b.x_min);

  const zoneByPageIndex: CoverZone[] = new Array(3);
  byX.forEach((page, rank) => {
    zoneByPageIndex[page.i] = order[rank];
  });

  return {
    zones: {
      back_width_mm: ptToMm(byX[0].x_max - byX[0].x_min),
      spine_width_mm: ptToMm(byX[1].x_max - byX[1].x_min),
      front_width_mm: ptToMm(byX[2].x_max - byX[2].x_min),
    },
    zoneByPageIndex,
  };
}

// ─── extractPlaceholders ──────────────────────────────────────────────────

export function extractPlaceholders(
  masterSpread: Record<string, unknown>,
  geometry: SpreadGeometry,
  masterName: string,
  warnings: ParserWarning[],
  resolver: StyleResolver,
  coverZones: CoverZoneResult | null = null,
): Placeholder[] {
  const frames = collectFrames(masterSpread);
  const result: Array<Placeholder & { _pageIndex: number }> = [];
  let unlabeledCount = 0;

  for (const frame of frames) {
    const originalLabel = extractLabel(frame.node);
    if (!originalLabel) {
      // Правило §6.2: фреймы без <KeyValuePair Key="Label"> пропускаем
      // как декоративные. Чтобы видеть это в S-Intro/S-Intro-Old и т.п. —
      // считаем количество и пишем ОДНУ агрегированную запись ниже.
      unlabeledCount++;
      continue;
    }

    const placeholder = frameToPlaceholder(
      frame,
      originalLabel,
      geometry,
      masterName,
      warnings,
      resolver,
    );
    if (placeholder) result.push(placeholder);
  }

  if (unlabeledCount > 0) {
    warnings.push({
      message: `${unlabeledCount} unlabeled frames skipped (decorative)`,
      master: masterName,
    });
  }

  // Часть 1 ТЗ: вычислить offset каждого декора относительно базового слота.
  // Делаем ПОСЛЕ сбора всех плейсхолдеров (базовый слот мог встретиться в
  // любом порядке), но ДО dedupeLabels (суффиксы _left/_right не трогают
  // привязку — декор и его база на одной странице).
  computeDecorationOffsets(result, masterName, warnings);

  dedupeLabels(result, masterName, warnings, coverZones?.zoneByPageIndex ?? null);

  // Обложка: помечаем каждый плейсхолдер зоной (задняя/корешок/передняя) по
  // странице 3-страничного разворота. _pageIndex — индекс страницы из pickPageIndex.
  if (coverZones) {
    for (const ph of result) {
      ph.zone = coverZones.zoneByPageIndex[ph._pageIndex] ?? undefined;
    }
  }

  return result.map(({ _pageIndex: _, ...rest }) => rest as Placeholder);
}

// ─── Сбор фреймов ─────────────────────────────────────────────────────────

function collectFrames(masterSpread: Record<string, unknown>): FrameRecord[] {
  const out: FrameRecord[] = [];
  for (const node of collectAll(masterSpread, 'Rectangle')) {
    out.push({ node, kind: 'rectangle' });
  }
  for (const node of collectAll(masterSpread, 'Oval')) {
    out.push({ node, kind: 'oval' });
  }
  for (const node of collectAll(masterSpread, 'TextFrame')) {
    out.push({ node, kind: 'textframe' });
  }
  return out;
}

// ─── Один фрейм → Placeholder ─────────────────────────────────────────────

function frameToPlaceholder(
  frame: FrameRecord,
  originalLabel: string,
  geometry: SpreadGeometry,
  masterName: string,
  warnings: ParserWarning[],
  resolver: StyleResolver,
): (Placeholder & { _pageIndex: number }) | null {
  const transform = parseItemTransform(getAttr(frame.node, 'ItemTransform'));
  if (!transform) {
    warnings.push({
      message: 'Frame skipped: missing or invalid ItemTransform',
      master: masterName,
      label: originalLabel,
    });
    return null;
  }

  const anchors = extractAnchorPoints(frame.node);
  if (anchors.length !== 4) {
    warnings.push({
      message: `Frame skipped in ${masterName}: expected 4 anchor points, got ${anchors.length}`,
      master: masterName,
      label: originalLabel,
    });
    return null;
  }

  const transformed = anchors.map((p) => applyTransform(transform, p));
  const bbox = boundingBox(transformed);

  const x_pt = bbox.x - geometry.origin.x;
  const y_pt = bbox.y - geometry.origin.y;
  const centroidX = bbox.x + bbox.width / 2;
  const pageIndex = pickPageIndex(centroidX, geometry.pages_x_ranges);

  const rotation = rotationDeg(transform);
  // Правило §6.4: lowercase-нормализация при импорте, оригинал в original_label.
  const label = originalLabel.toLowerCase();

  const common = {
    label,
    original_label: originalLabel,
    x_mm: ptToMm(x_pt),
    y_mm: ptToMm(y_pt),
    width_mm: ptToMm(bbox.width),
    height_mm: ptToMm(bbox.height),
    rotation_deg: rotation,
  };

  // Часть 1 ТЗ: привязанный декор. Метка вида `<base>__under` / `<base>__over`
  // → это статичная картинка-декор, а НЕ фото-слот. Перехватываем ДО
  // kind-ветвления (иначе rectangle-декор стал бы фиктивным фото-слотом).
  const decor = parseDecorationLabel(label);
  if (decor) {
    const embedded = extractEmbeddedImage(frame.node, masterName, label, warnings);
    if (!embedded) {
      // Декор без извлекаемой картинки бесполезен — пропускаем (warning внутри
      // extractEmbeddedImage уже записан).
      return null;
    }
    return {
      ...common,
      type: 'decoration',
      attached_to: decor.attached_to,
      layer: decor.layer,
      url: '', // заполнится на Этапе 2б при загрузке в storage
      offset_x_mm: 0, // пересчитается в computeDecorationOffsets
      offset_y_mm: 0,
      _embedded: embedded,
      _pageIndex: pageIndex,
    };
  }

  // required = false всегда — обязательность это продуктовая логика album-builder'а.
  if (frame.kind === 'rectangle') {
    // Часть 2 ТЗ: свойства фото-фрейма — скруглённые углы + внешнее свечение.
    const frameProps = extractFrameProps(frame.node);
    return {
      ...common,
      type: 'photo',
      fit: 'fill_proportional',
      required: false,
      ...frameProps,
      _pageIndex: pageIndex,
    };
  }

  if (frame.kind === 'oval') {
    return {
      ...common,
      type: 'photo',
      fit: 'fill_proportional',
      required: false,
      is_circle: true,
      _pageIndex: pageIndex,
    };
  }

  // textframe — стили резолвятся через StyleResolver
  // (Resources/Styles.xml + Stories/*.xml + Resources/Graphic.xml).
  // auto_fit правила по label применяются внутри resolveTextStyle.
  const parentStoryId = getAttr(frame.node, 'ParentStory') ?? null;
  const textStyle = resolver.resolveTextStyle(
    parentStoryId,
    label,
    masterName,
    warnings,
  );
  // РЭ.56: исходный текст из IDML → default_text у placeholder.
  // Так декоративные надписи в мастерах («Дорогие выпускники!», и т.п.)
  // попадают в БД и в редактор как редактируемое значение по умолчанию.
  // Пустые story (без <Content>) возвращают undefined — поле default_text
  // остаётся undefined и в БД сохраняется как null.
  const defaultText = resolver.resolveTextContent(parentStoryId);
  return {
    ...common,
    type: 'text',
    ...textStyle,
    ...(defaultText !== undefined ? { default_text: defaultText } : {}),
    _pageIndex: pageIndex,
  };
}

// ─── Дедупликация label'ов ────────────────────────────────────────────────

function dedupeLabels(
  placeholders: Array<Placeholder & { _pageIndex: number }>,
  masterName: string,
  warnings: ParserWarning[],
  coverZoneByPageIndex: readonly CoverZone[] | null = null,
): void {
  // Группируем по label, в группах с >1 — добавляем суффиксы по pageIndex.
  const byLabel = new Map<
    string,
    Array<Placeholder & { _pageIndex: number }>
  >();
  for (const ph of placeholders) {
    const list = byLabel.get(ph.label);
    if (list) list.push(ph);
    else byLabel.set(ph.label, [ph]);
  }

  byLabel.forEach((group, label) => {
    if (group.length === 1) return;

    warnings.push({
      message: coverZoneByPageIndex
        ? 'duplicate label, generated _back/_spine/_front suffixes'
        : 'duplicate label, generated _left/_right suffixes',
      master: masterName,
      label,
    });

    for (const ph of group) {
      // Обложка: суффикс по зоне (_back/_spine/_front), иначе _left/_right.
      const suffix = coverZoneByPageIndex
        ? `_${coverZoneByPageIndex[ph._pageIndex] ?? 'back'}`
        : ph._pageIndex === 0
          ? '_left'
          : '_right';
      ph.label = `${label}${suffix}`;
    }
  });
}

// ─── Свойства фото-фрейма (Часть 2 ТЗ) ────────────────────────────────────

/**
 * Читает из <Rectangle> декоративные свойства рамки (Часть 2 ТЗ):
 *   - скруглённые углы: `TopLeftCornerOption="Rounded"` + `*CornerRadius` (pt).
 *     Берём TopLeft как репрезентативный (в наших мастерах все 4 угла равны).
 *   - внешнее свечение: `<TransparencySetting><OuterGlowSetting Size="..."/>`.
 *     Цвет в IDML обычно отсутствует — заполнится на 6б из цвета декора.
 *
 * Возвращает только заданные поля (пустой объект, если рамка обычная) —
 * чтобы у прямоугольных фото без оформления не появлялись лишние ключи.
 */
function extractFrameProps(
  frameNode: Record<string, unknown>,
): { corner_radius_mm?: number; glow_size_pt?: number } {
  const out: { corner_radius_mm?: number; glow_size_pt?: number } = {};

  // Скруглённые углы: по наличию ненулевого радиуса. InDesign при экспорте
  // в IDML НЕ пишет CornerOption (атрибут отсутствует), но пишет
  // TopLeftCornerRadius — и рендерит скругление по нему. Поэтому ориентируемся
  // на радиус, а не на CornerOption. Прямоугольные рамки (classphotoframe)
  // радиуса не имеют → corner_radius_mm не ставится.
  const cornerRadiusRaw =
    getAttr(frameNode, 'TopLeftCornerRadius') ?? getAttr(frameNode, 'CornerRadius');
  if (cornerRadiusRaw) {
    const r = Number(cornerRadiusRaw);
    if (Number.isFinite(r) && r > 0) out.corner_radius_mm = ptToMm(r);
  }

  // Внешнее свечение: <OuterGlowSetting Size="..."> на любой глубине фрейма.
  const glow = findFirst(frameNode, 'OuterGlowSetting');
  if (glow) {
    const sizeRaw = getAttr(glow, 'Size');
    if (sizeRaw) {
      const s = Number(sizeRaw);
      if (Number.isFinite(s) && s > 0) out.glow_size_pt = s;
    }
  }

  return out;
}

// ─── Декор (Часть 1 ТЗ) ───────────────────────────────────────────────────

/**
 * Распознаёт метку декора:
 *   - `<base>__under` / `<base>__over` — привязанный декор (Часть 1 ТЗ);
 *   - `__fg_<n>` / `__fg` — декор переднего плана (Часть 4 ТЗ): поверх всего
 *     разворота, не привязан к слоту (attached_to=''). Номер `<n>` нужен лишь
 *     чтобы у нескольких таких фреймов были уникальные метки.
 *
 * Суффикс under/over — РОВНО два подчёркивания + слово в конце; одиночные
 * подчёркивания внутри base (`teacherphoto_1`) сохраняются.
 *
 * Возвращает null если метка не декоративная (обычный слот).
 */
function parseDecorationLabel(
  label: string,
): { attached_to: string; layer: 'under' | 'over' | 'foreground' } | null {
  // Передний план: __fg, __fg_1, __fg_2 … (проверяем ДО under/over —
  // у __fg нет базового слота).
  if (/^__fg(_\d+)?$/.test(label)) {
    return { attached_to: '', layer: 'foreground' };
  }
  const m = label.match(/^(.+)__(under|over)$/);
  if (!m) return null;
  return { attached_to: m[1], layer: m[2] as 'under' | 'over' };
}

/**
 * Извлекает embedded-картинку из фрейма декора.
 *
 * В IDML вшитая картинка лежит в `<Image><Properties><Contents>…base64…`.
 * У того же `<Image>` есть второй `<Contents>` под `MetadataPacketPreference`
 * с XMP-метаданными (начинается с `<?xpacket`) — его игнорируем.
 *
 * Поддерживаем PNG и JPEG (sniff по началу base64). EPS/PDF/прочее не
 * поддерживаем — пишем warning и возвращаем null.
 */
function extractEmbeddedImage(
  frameNode: Record<string, unknown>,
  masterName: string,
  label: string,
  warnings: ParserWarning[],
): EmbeddedImage | null {
  const image = findFirst(frameNode, 'Image');
  if (!image) {
    warnings.push({
      message: 'decoration frame has no embedded <Image> (EPS/PDF/link not supported)',
      master: masterName,
      label,
    });
    return null;
  }

  // У <Image> ДВА <Contents>: картинка (Image>Properties) и XMP-метаданные
  // (MetadataPacketPreference). Собираем оба и выбираем тот, что по сигнатуре
  // base64 — настоящая картинка (PNG/JPEG). XMP начинается с '<?xpacket' и
  // отсеивается автоматически (sniff вернёт null).
  // fast-xml-parser отдаёт текст-only <Contents> как СТРОКУ, а не объект —
  // поэтому собираем рекурсивно и строки, и {#text}-узлы.
  const candidates = collectContentsTexts(image);
  for (const raw of candidates) {
    const format = sniffImageFormat(raw);
    if (format) return { base64: raw, format };
  }

  warnings.push({
    message:
      candidates.length === 0
        ? 'decoration <Image> has no <Contents> base64 data'
        : 'decoration image is not PNG/JPEG (unsupported embedded format)',
    master: masterName,
    label,
  });
  return null;
}

/** Определяет формат картинки по началу base64 (PNG `iVBOR…`, JPEG `/9j/`). */
function sniffImageFormat(base64: string): 'png' | 'jpeg' | null {
  if (base64.startsWith('iVBORw0KGgo')) return 'png';
  if (base64.startsWith('/9j/')) return 'jpeg';
  return null;
}

/**
 * Рекурсивно собирает текст всех `<Contents>` внутри узла.
 * fast-xml-parser представляет текст-only элемент как строку, элемент с
 * атрибутами — как объект с '#text', повторяющиеся — как массив. Покрываем
 * все три формы.
 */
function collectContentsTexts(node: Record<string, unknown>): string[] {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.trim()) out.push(value.trim());
      return;
    }
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    const text = obj['#text'];
    if (typeof text === 'string' && text.trim()) out.push(text.trim());
  };
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const obj = n as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (key.startsWith('@_') || key === '#text') continue;
      const v = obj[key];
      if (key === 'Contents') {
        if (Array.isArray(v)) v.forEach(visit);
        else visit(v);
      }
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(node);
  return out;
}

/**
 * Часть 1 ТЗ (динамика): offset декора = его исходная позиция − позиция
 * базового слота. По нему builder (Этап 3) пересчитает позицию декора, когда
 * базовый слот сдвинут симметризацией (`__pos__`): deco = new_base + offset.
 *
 * Базовый слот ищется по точному совпадению label === attached_to. Если базы
 * нет (опечатка в метке) — warning, offset остаётся 0 (декор останется на
 * исходном месте, но не будет следовать за слотом).
 */
function computeDecorationOffsets(
  placeholders: Array<Placeholder & { _pageIndex: number }>,
  masterName: string,
  warnings: ParserWarning[],
): void {
  const byLabel = new Map<string, Placeholder>();
  for (const ph of placeholders) byLabel.set(ph.label, ph);

  for (const ph of placeholders) {
    if (ph.type !== 'decoration') continue;
    const deco = ph as DecorationPlaceholder & { _pageIndex: number };
    // Передний план (Часть 4) не привязан к слоту — offset не нужен.
    if (deco.layer === 'foreground') continue;
    const base = byLabel.get(deco.attached_to);
    if (!base) {
      warnings.push({
        message: `decoration attached_to '${deco.attached_to}' has no matching base slot`,
        master: masterName,
        label: deco.label,
      });
      continue;
    }
    deco.offset_x_mm = deco.x_mm - base.x_mm;
    deco.offset_y_mm = deco.y_mm - base.y_mm;
  }
}

// ─── Вспомогательные функции ──────────────────────────────────────────────

function pickPageIndex(
  centroidX: number,
  ranges: Array<{ x_min: number; x_max: number }>,
): number {
  if (ranges.length <= 1) return 0;
  for (let i = 0; i < ranges.length; i++) {
    if (centroidX >= ranges[i].x_min && centroidX <= ranges[i].x_max) {
      return i;
    }
  }
  // Centroid за пределами всех страниц — выбираем ближайшую по расстоянию до центра.
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < ranges.length; i++) {
    const center = (ranges[i].x_min + ranges[i].x_max) / 2;
    const dist = Math.abs(centroidX - center);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function parseItemTransform(raw: string | undefined): ItemTransform | null {
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length !== 6 || parts.some((n) => Number.isNaN(n))) return null;
  return {
    a: parts[0],
    b: parts[1],
    c: parts[2],
    d: parts[3],
    tx: parts[4],
    ty: parts[5],
  };
}

function parseAnchor(raw: string | undefined): Point | null {
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1] };
}

function applyTransform(t: ItemTransform, p: Point): Point {
  return {
    x: t.a * p.x + t.c * p.y + t.tx,
    y: t.b * p.x + t.d * p.y + t.ty,
  };
}

function boundingBox(points: Point[]): BBox {
  const x_min = points.reduce((m, p) => Math.min(m, p.x), Infinity);
  const y_min = points.reduce((m, p) => Math.min(m, p.y), Infinity);
  const x_max = points.reduce((m, p) => Math.max(m, p.x), -Infinity);
  const y_max = points.reduce((m, p) => Math.max(m, p.y), -Infinity);
  return { x: x_min, y: y_min, width: x_max - x_min, height: y_max - y_min };
}

/** rotation_deg = atan2(b, a) * 180/π, нормализован к [-180, 180] (recon-notes §6.6). */
function rotationDeg(t: ItemTransform): number {
  const deg = (Math.atan2(t.b, t.a) * 180) / Math.PI;
  // atan2 уже даёт [-180, 180]; округляем до 4 знаков чтобы убрать FP-шум.
  return Math.round(deg * 10000) / 10000;
}

function extractLabel(frameNode: Record<string, unknown>): string | null {
  const props = findFirst(frameNode, 'Properties');
  if (!props) return null;
  const labelEl = findFirst(props, 'Label');
  if (!labelEl) return null;

  const kvps = toArray(labelEl['KeyValuePair']);
  for (const kvp of kvps) {
    if (getAttr(kvp, 'Key') === 'Label') {
      const value = getAttr(kvp, 'Value');
      if (value && value.trim()) return value.trim();
    }
  }
  return null;
}

function extractAnchorPoints(frameNode: Record<string, unknown>): Point[] {
  const props = findFirst(frameNode, 'Properties');
  if (!props) return [];
  const pathGeometry = findFirst(props, 'PathGeometry');
  if (!pathGeometry) return [];
  const geomPathType = findFirst(pathGeometry, 'GeometryPathType');
  if (!geomPathType) return [];
  const pathPointArray = findFirst(geomPathType, 'PathPointArray');
  if (!pathPointArray) return [];

  const pointTypes = toArray(pathPointArray['PathPointType']);
  const out: Point[] = [];
  for (const pt of pointTypes) {
    const p = parseAnchor(getAttr(pt, 'Anchor'));
    if (p) out.push(p);
  }
  return out;
}

function toArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === 'object') {
    return [value as Record<string, unknown>];
  }
  return [];
}
