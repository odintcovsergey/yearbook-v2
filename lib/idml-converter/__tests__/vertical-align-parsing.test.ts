/**
 * Чтение вертикальной выключки текста из IDML (VerticalJustification).
 *
 * Баг «Аква меч»: дизайнер ставил цитату по центру фрейма
 * (<TextFramePreference VerticalJustification="CenterAlign">), а парсер
 * хардкодил vertical_align='top' → текст прижимался к верху. extractVerticalAlign
 * читает атрибут фрейма.
 */

import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { extractVerticalAlign } from '../extract-geometry';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

function frameNode(verticalJustification: string | null): Record<string, unknown> {
  const pref =
    verticalJustification === null
      ? '<TextFramePreference />'
      : `<TextFramePreference VerticalJustification="${verticalJustification}" />`;
  const xml = `<TextFrame Self="frame_1">${pref}</TextFrame>`;
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  return parsed.TextFrame as Record<string, unknown>;
}

describe('extractVerticalAlign', () => {
  it('CenterAlign → middle', () => {
    expect(extractVerticalAlign(frameNode('CenterAlign'))).toBe('middle');
  });

  it('BottomAlign → bottom', () => {
    expect(extractVerticalAlign(frameNode('BottomAlign'))).toBe('bottom');
  });

  it('TopAlign → top', () => {
    expect(extractVerticalAlign(frameNode('TopAlign'))).toBe('top');
  });

  it('JustifyAlign → middle (разгон не поддерживаем, центр ближе)', () => {
    expect(extractVerticalAlign(frameNode('JustifyAlign'))).toBe('middle');
  });

  it('нет атрибута → top (дефолт InDesign)', () => {
    expect(extractVerticalAlign(frameNode(null))).toBe('top');
  });

  it('нет TextFramePreference → top', () => {
    const parsed = xmlParser.parse('<TextFrame Self="f" />') as Record<string, unknown>;
    expect(extractVerticalAlign(parsed.TextFrame as Record<string, unknown>)).toBe('top');
  });
});
