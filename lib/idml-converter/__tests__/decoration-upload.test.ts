/**
 * Этап 2б ТЗ привязанного декора (docs/tz-attached-decor.md, Часть 1).
 *
 * Проверяет что uploadTemplateSetToSupabase:
 *   - декодирует embedded-картинку декора и грузит её в bucket template-decorations;
 *   - проставляет публичный url в placeholder;
 *   - УДАЛЯЕТ транзитное `_embedded` перед записью placeholders в БД
 *     (иначе base64 раздул бы jsonb-строки);
 *   - обычные слоты (фото/текст) в БД не трогает.
 *
 * Supabase-клиент полностью замокан — БД/сеть не нужны. Прогоняем РЕАЛЬНЫЙ
 * образец docs/для теста.idml через parseIdml, затем upload с mock-клиентом
 * и инспектируем, что улетело в storage.upload и в spread_templates.insert.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIdml } from '../parse';
import { uploadTemplateSetToSupabase, type UploadMeta } from '../upload';
import type { DecorationPlaceholder } from '../types';

const SAMPLE_PATH = join(process.cwd(), 'docs', 'для теста.idml');

type StorageUploadCall = { bucket: string; path: string; body: unknown; opts: unknown };

/**
 * Минимальный мок SupabaseClient: фиксирует storage-загрузки и insert-строки,
 * имитирует «template_set не существует» (чистая вставка, без force-ветки).
 */
function makeMockSupabase() {
  const storageUploads: StorageUploadCall[] = [];
  const inserted: { table: string; rows: unknown }[] = [];

  const client = {
    from(table: string) {
      return {
        // SELECT existing → maybeSingle returns {data:null} (нет дубля)
        select() {
          return {
            eq() {
              return this;
            },
            is() {
              return this;
            },
            maybeSingle() {
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        insert(rows: unknown) {
          inserted.push({ table, rows });
          // template_sets.insert(...).select('id').single() → возвращает id
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({ data: { id: 'ts-test-id' }, error: null });
                },
              };
            },
            // spread_templates.insert(rows) — await напрямую
            then(resolve: (v: { error: null }) => void) {
              resolve({ error: null });
            },
          };
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          upload(path: string, body: unknown, opts: unknown) {
            storageUploads.push({ bucket, path, body, opts });
            return Promise.resolve({ error: null });
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://stub.local/${bucket}/${path}` } };
          },
        };
      },
    },
  };

  return { client: client as never, storageUploads, inserted };
}

const META: UploadMeta = {
  name: 'Декор Тест',
  slug: 'decor-test',
  tenantId: null,
  printType: 'soft',
};

describe('decoration upload (Этап 2б)', () => {
  it('грузит картинки декора в bucket и проставляет url', async () => {
    const parsed = await parseIdml(readFileSync(SAMPLE_PATH));
    const { client, storageUploads } = makeMockSupabase();

    await uploadTemplateSetToSupabase(parsed, META, client);

    // Должны быть загрузки только в bucket template-decorations.
    expect(storageUploads.length).toBeGreaterThanOrEqual(2); // __over + __under
    for (const up of storageUploads) {
      expect(up.bucket).toBe('template-decorations');
      // тело — Buffer (декодированная картинка), не строка base64
      expect(Buffer.isBuffer(up.body)).toBe(true);
      expect((up.body as Buffer).length).toBeGreaterThan(1000);
      // upsert:true для идемпотентной перезагрузки (--force)
      expect((up.opts as { upsert?: boolean }).upsert).toBe(true);
      expect(up.path.endsWith('.png') || up.path.endsWith('.jpg')).toBe(true);
    }

    // В parsed url проставлен, _embedded удалён.
    const decors = parsed.spread_templates
      .flatMap((s) => s.placeholders)
      .filter((p): p is DecorationPlaceholder => p.type === 'decoration');
    expect(decors.length).toBeGreaterThanOrEqual(2);
    for (const d of decors) {
      expect(d.url).toMatch(/^https:\/\/stub\.local\/template-decorations\//);
      expect(d._embedded).toBeUndefined();
    }
  });

  it('не пишет base64 (_embedded) в spread_templates.insert', async () => {
    const parsed = await parseIdml(readFileSync(SAMPLE_PATH));
    const { client, inserted } = makeMockSupabase();

    await uploadTemplateSetToSupabase(parsed, META, client);

    const spreadInsert = inserted.find((i) => i.table === 'spread_templates');
    expect(spreadInsert).toBeDefined();
    const serialized = JSON.stringify(spreadInsert!.rows);
    // base64-картинки в БД быть не должно (поле _embedded и сигнатура PNG).
    expect(serialized).not.toContain('_embedded');
    expect(serialized).not.toContain('iVBORw0KGgo');
    // но url декора — должен присутствовать.
    expect(serialized).toContain('template-decorations');
  });

  it('Этап 6б: фото-фрейм со свечением получает цвет из декора', async () => {
    const parsed = await parseIdml(readFileSync(SAMPLE_PATH));
    const { client } = makeMockSupabase();

    await uploadTemplateSetToSupabase(parsed, META, client);

    // teacherphoto_1 имеет glow_size_pt (из IDML) и привязанный декор
    // teacherphoto_1__over → должен получить glow_color из доминирующего цвета.
    const photo = parsed.spread_templates
      .flatMap((s) => s.placeholders)
      .find((p) => p.label === 'teacherphoto_1') as
      | (import('../types').PhotoPlaceholder)
      | undefined;
    expect(photo).toBeDefined();
    expect(photo!.glow_size_pt).toBeGreaterThan(0);
    // Цвет подобран (валидный hex). Точный оттенок зависит от картинки —
    // проверяем только формат, не конкретное значение.
    expect(photo!.glow_color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
