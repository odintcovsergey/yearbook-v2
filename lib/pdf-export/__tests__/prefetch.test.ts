/**
 * Тесты предзагрузки фото (ускорение экспорта).
 *
 * Проверяем чистую часть — сбор URL фото из развёрстки: служебные ключи и
 * текстовые значения отсеиваются, фото-URL дедуплицируются. Сетевой префетч
 * (prefetchPhotoSources) здесь не тестируем — он завязан на fetch/S3.
 */

import { describe, it, expect } from 'vitest';
import { collectPhotoUrlsFromSpreads } from '../photo-embed';

describe('collectPhotoUrlsFromSpreads', () => {
  it('берёт только http-значения, пропускает текст и null', () => {
    const urls = collectPhotoUrlsFromSpreads([
      {
        data: {
          studentportrait_1: 'https://cdn/x/a.webp',
          studentname_1: 'Иванов Иван',
          studentquote: 'Цитата без url',
          studentportrait_2: null,
        },
      },
    ]);
    expect(urls).toEqual(['https://cdn/x/a.webp']);
  });

  it('пропускает служебные ключи (__scale__, __bg__ и т.п.)', () => {
    const urls = collectPhotoUrlsFromSpreads([
      {
        data: {
          studentportrait_1: 'https://cdn/x/a.webp',
          __scale__studentportrait_1: '1.2',
          __bg__: 'https://cdn/bg/fon.png',
          __offset__studentportrait_1: '0,0',
        },
      },
    ]);
    // __bg__ — фон, грузится отдельным механизмом; в фото-префетч не идёт.
    expect(urls).toEqual(['https://cdn/x/a.webp']);
  });

  it('дедуплицирует один и тот же url из разных разворотов/слотов', () => {
    const urls = collectPhotoUrlsFromSpreads([
      { data: { p1: 'https://cdn/dup.webp', p2: 'https://cdn/dup.webp' } },
      { data: { p1: 'https://cdn/dup.webp', p3: 'https://cdn/other.webp' } },
    ]);
    expect(urls.sort()).toEqual(['https://cdn/dup.webp', 'https://cdn/other.webp']);
  });

  it('устойчив к пустым data', () => {
    expect(collectPhotoUrlsFromSpreads([{ data: null }, {}])).toEqual([]);
  });
});
