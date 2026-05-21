/**
 * Тесты для spread-master-filter.
 *
 * Покрывают:
 *  - isSpreadMaster — детекция по имени и page_role
 *  - isMasterAllowedForPrintType — для layflat всё разрешено, для soft
 *    блокируются spread-мастера
 */

import { describe, it, expect } from 'vitest';
import {
  isSpreadMaster,
  isMasterAllowedForPrintType,
} from '../spread-master-filter';

describe('isSpreadMaster (РЭ.27)', () => {
  it('детектит J-Spread по имени', () => {
    expect(isSpreadMaster({ name: 'J-Spread' })).toBe(true);
  });

  it('детектит любое имя со словом Spread', () => {
    expect(isSpreadMaster({ name: 'J-Spread-Full' })).toBe(true);
    expect(isSpreadMaster({ name: 'BigSpread' })).toBe(true);
    expect(isSpreadMaster({ name: 'Spread-1' })).toBe(true);
  });

  it('детектит по page_role=common_spread', () => {
    expect(isSpreadMaster({ name: 'Anything', page_role: 'common_spread' })).toBe(true);
  });

  it('детектит по page_role=student_spread', () => {
    expect(isSpreadMaster({ name: 'Anything', page_role: 'student_spread' })).toBe(true);
  });

  it('не детектит обычные мастера', () => {
    expect(isSpreadMaster({ name: 'E-Student-Standard' })).toBe(false);
    expect(isSpreadMaster({ name: 'F-Head-SmallGrid' })).toBe(false);
    expect(isSpreadMaster({ name: 'J-ClassPhoto' })).toBe(false);
    expect(isSpreadMaster({ name: 'S-Intro' })).toBe(false);
  });

  it('не детектит мастера без spread-роли даже если имя похоже', () => {
    // 'spread' с маленькой буквы — не считается; маркер — Spread с большой.
    expect(isSpreadMaster({ name: 'spread-something' })).toBe(false);
  });

  it('обрабатывает edge case с пустым именем', () => {
    expect(isSpreadMaster({ name: '' })).toBe(false);
  });

  it('обрабатывает edge case с невалидным типом name', () => {
    // @ts-expect-error — намеренно невалидный тип для проверки защиты
    expect(isSpreadMaster({ name: 42 })).toBe(false);
    // @ts-expect-error — намеренно невалидный тип
    expect(isSpreadMaster({ name: null })).toBe(false);
    // @ts-expect-error — намеренно невалидный тип
    expect(isSpreadMaster(null)).toBe(false);
  });

  it('обрабатывает page_role в нестандартных значениях', () => {
    expect(isSpreadMaster({ name: 'X', page_role: 'student' })).toBe(false);
    expect(isSpreadMaster({ name: 'X', page_role: null })).toBe(false);
    expect(isSpreadMaster({ name: 'X', page_role: undefined })).toBe(false);
  });
});

describe('isMasterAllowedForPrintType (РЭ.27)', () => {
  it('layflat — все мастера разрешены, включая spread', () => {
    expect(isMasterAllowedForPrintType({ name: 'J-Spread' }, 'layflat')).toBe(true);
    expect(isMasterAllowedForPrintType({ name: 'E-Student-Standard' }, 'layflat')).toBe(true);
  });

  it('soft — spread-мастера запрещены', () => {
    expect(isMasterAllowedForPrintType({ name: 'J-Spread' }, 'soft')).toBe(false);
    expect(isMasterAllowedForPrintType({ name: 'J-Spread-Full' }, 'soft')).toBe(false);
    expect(isMasterAllowedForPrintType({ name: 'X', page_role: 'common_spread' }, 'soft')).toBe(false);
  });

  it('soft — обычные мастера разрешены', () => {
    expect(isMasterAllowedForPrintType({ name: 'E-Student-Standard' }, 'soft')).toBe(true);
    expect(isMasterAllowedForPrintType({ name: 'S-Intro' }, 'soft')).toBe(true);
    expect(isMasterAllowedForPrintType({ name: 'F-Head-SmallGrid' }, 'soft')).toBe(true);
  });
});
