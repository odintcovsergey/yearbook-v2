/**
 * Часть 3 ТЗ (Путь А): текстовые эффекты обводка/свечение из штатных
 * эффектов InDesign.
 *
 * Дизайнер рисует их обычными средствами InDesign:
 *   - обводка букв → Stroke на тексте (StrokeColor + StrokeWeight на
 *     CharacterStyleRange внутри Story);
 *   - свечение → эффект Outer Glow на текстовом фрейме
 *     (<OuterGlowSetting Size= EffectColor=> в TransparencySetting фрейма).
 *
 * Парсер должен прочитать их в поля TextPlaceholder:
 *   text_stroke_color / text_stroke_width_pt / text_glow_color / text_glow_blur_pt.
 *
 * Здесь — изолированные юнит-тесты на двух точках чтения:
 *   - обводка: через настоящий StyleResolver (loadStyleResolver) на
 *     синтетическом мини-IDML (Stories + Graphic + Styles);
 *   - свечение: через extractTextGlow на распарсенном узле фрейма.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { loadStyleResolver } from '../extract-styles';
import { extractTextGlow } from '../extract-geometry';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

const GRAPHIC_XML = `<?xml version="1.0"?>
<idPkg:Graphic xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
  <Color Self="Color/Red" Space="CMYK" ColorValue="0 100 100 0" />
  <Color Self="Color/GlowBlue" Space="RGB" ColorValue="0 0 255" />
</idPkg:Graphic>`;

const STYLES_XML = `<?xml version="1.0"?>
<idPkg:Styles xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
  <RootParagraphStyleGroup Self="rps" />
</idPkg:Styles>`;

/** Story с применённой обводкой (StrokeColor реальный + StrokeWeight=2pt). */
const STORY_WITH_STROKE = `<?xml version="1.0"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
  <Story Self="Story_stroke">
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/[No paragraph style]">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="24" FillColor="Color/Black" StrokeColor="Color/Red" StrokeWeight="2">
        <Content>ФИО</Content>
      </CharacterStyleRange>
    </ParagraphStyleRange>
  </Story>
</idPkg:Story>`;

/**
 * Story без обводки: StrokeWeight есть (дефолт InDesign ~0.4 на каждом ранже),
 * но StrokeColor отсутствует — значит обводка НЕ применена.
 */
const STORY_NO_STROKE = `<?xml version="1.0"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
  <Story Self="Story_plain">
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/[No paragraph style]">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="24" FillColor="Color/Black" StrokeWeight="0.39996">
        <Content>ФИО</Content>
      </CharacterStyleRange>
    </ParagraphStyleRange>
  </Story>
</idPkg:Story>`;

/** Story с StrokeColor="Swatch/None" — «нет цвета», обводки быть не должно. */
const STORY_STROKE_NONE = `<?xml version="1.0"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
  <Story Self="Story_none">
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/[No paragraph style]">
      <CharacterStyleRange PointSize="24" StrokeColor="Swatch/None" StrokeWeight="3">
        <Content>ФИО</Content>
      </CharacterStyleRange>
    </ParagraphStyleRange>
  </Story>
</idPkg:Story>`;

async function buildResolver(...stories: Array<[string, string]>) {
  const zip = new JSZip();
  zip.file('Resources/Graphic.xml', GRAPHIC_XML);
  zip.file('Resources/Styles.xml', STYLES_XML);
  for (const [name, xml] of stories) {
    zip.file(`Stories/${name}.xml`, xml);
  }
  return loadStyleResolver(zip);
}

function parseFrame(xml: string): Record<string, unknown> {
  return xmlParser.parse(xml) as Record<string, unknown>;
}

describe('текстовые эффекты — обводка (Stroke на тексте)', () => {
  it('читает text_stroke_color + text_stroke_width_pt из реального Stroke', async () => {
    const resolver = await buildResolver(['Story_stroke', STORY_WITH_STROKE]);
    const props = resolver.resolveTextStyle('Story_stroke', 'studentname', 'M', []);
    // CMYK 0 100 100 0 → красный.
    expect(props.text_stroke_color).toBe('#ff0000');
    expect(props.text_stroke_width_pt).toBe(2);
  });

  it('без StrokeColor обводки нет (дефолтный StrokeWeight игнорируется)', async () => {
    const resolver = await buildResolver(['Story_plain', STORY_NO_STROKE]);
    const props = resolver.resolveTextStyle('Story_plain', 'studentname', 'M', []);
    expect(props.text_stroke_color).toBeUndefined();
    expect(props.text_stroke_width_pt).toBeUndefined();
  });

  it('StrokeColor="Swatch/None" трактуется как отсутствие обводки', async () => {
    const resolver = await buildResolver(['Story_none', STORY_STROKE_NONE]);
    const props = resolver.resolveTextStyle('Story_none', 'studentname', 'M', []);
    expect(props.text_stroke_color).toBeUndefined();
    expect(props.text_stroke_width_pt).toBeUndefined();
  });
});

describe('текстовые эффекты — свечение (Outer Glow на фрейме)', () => {
  it('читает text_glow_blur_pt + text_glow_color из OuterGlowSetting', async () => {
    const resolver = await buildResolver();
    const node = parseFrame(`
      <TextFrame Self="tf1" ParentStory="Story_stroke">
        <Properties/>
        <TransparencySetting>
          <OuterGlowSetting Size="6.3" EffectColor="Color/GlowBlue" />
        </TransparencySetting>
      </TextFrame>`);
    const glow = extractTextGlow(node, resolver);
    expect(glow.text_glow_blur_pt).toBeCloseTo(6.3, 5);
    expect(glow.text_glow_color).toBe('#0000ff');
  });

  it('цвет свечения читается и из атрибута GlowColor (другая версия InDesign)', async () => {
    const resolver = await buildResolver();
    const node = parseFrame(`
      <TextFrame Self="tf1">
        <TransparencySetting>
          <OuterGlowSetting Size="5" GlowColor="Color/GlowBlue" />
        </TransparencySetting>
      </TextFrame>`);
    const glow = extractTextGlow(node, resolver);
    expect(glow.text_glow_blur_pt).toBe(5);
    expect(glow.text_glow_color).toBe('#0000ff');
  });

  it('без EffectColor свечение получает дефолтный чёрный', async () => {
    const resolver = await buildResolver();
    const node = parseFrame(`
      <TextFrame Self="tf1">
        <TransparencySetting><OuterGlowSetting Size="4" /></TransparencySetting>
      </TextFrame>`);
    const glow = extractTextGlow(node, resolver);
    expect(glow.text_glow_blur_pt).toBe(4);
    expect(glow.text_glow_color).toBe('#000000');
  });

  it('фрейм без OuterGlowSetting → пустой объект (нет лишних ключей)', async () => {
    const resolver = await buildResolver();
    const node = parseFrame(`<TextFrame Self="tf1"><TransparencySetting/></TextFrame>`);
    expect(extractTextGlow(node, resolver)).toEqual({});
  });

  it('Applied="false" (документный дефолт) не считается применённым свечением', async () => {
    const resolver = await buildResolver();
    const node = parseFrame(`
      <TextFrame Self="tf1">
        <TransparencySetting>
          <OuterGlowSetting Applied="false" Size="7" EffectColor="Color/GlowBlue" />
        </TransparencySetting>
      </TextFrame>`);
    expect(extractTextGlow(node, resolver)).toEqual({});
  });

  it('Size=0 не считается свечением', async () => {
    const resolver = await buildResolver();
    const node = parseFrame(`
      <TextFrame Self="tf1">
        <TransparencySetting><OuterGlowSetting Size="0" /></TransparencySetting>
      </TextFrame>`);
    expect(extractTextGlow(node, resolver)).toEqual({});
  });
});
