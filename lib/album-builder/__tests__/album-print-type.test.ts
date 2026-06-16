import { describe, it, expect } from 'vitest';
import { resolveAlbumEffectivePrintType } from '../album-print-type';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Мок Supabase: запоминает, к какой таблице и по какому ключу обратились,
 * и отдаёт заранее заданный print_type. Эмулирует цепочку
 * .from(table).select().eq(col, val).maybeSingle().
 */
function mockSupabase(
  responses: Record<string, { col: string; val: string; print_type: string | null }>,
) {
  const calls: Array<{ table: string; col: string; val: string }> = [];
  const client = {
    from(table: string) {
      let captured = { col: '', val: '' };
      const chain = {
        select() {
          return chain;
        },
        eq(col: string, val: string) {
          captured = { col, val };
          return chain;
        },
        async maybeSingle() {
          calls.push({ table, ...captured });
          const r = responses[table];
          return { data: r ? { print_type: r.print_type } : null, error: null };
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('resolveAlbumEffectivePrintType', () => {
  it('album.print_type задан → возвращает его, в БД за пресетом не лезет', async () => {
    const { client, calls } = mockSupabase({});
    const pt = await resolveAlbumEffectivePrintType(client, {
      print_type: 'soft',
      section_structure_preset_id: 'ss-1',
    });
    expect(pt).toBe('soft');
    expect(calls).toHaveLength(0); // короткое замыкание — запросов нет
  });

  it('album без типа → fallback на presets по id (uuid), НЕ по slug', async () => {
    const { client, calls } = mockSupabase({
      presets: { col: 'id', val: 'ss-1', print_type: 'soft' },
    });
    const pt = await resolveAlbumEffectivePrintType(client, {
      print_type: null,
      section_structure_preset_id: 'ss-1',
    });
    expect(pt).toBe('soft');
    // критично: таблица presets, ключ id (исторический баг — был slug)
    expect(calls).toEqual([{ table: 'presets', col: 'id', val: 'ss-1' }]);
  });

  it('album без типа + legacy config_preset_id → config_presets по slug', async () => {
    const { client, calls } = mockSupabase({
      config_presets: { col: 'slug', val: 'mini12', print_type: 'soft' },
    });
    const pt = await resolveAlbumEffectivePrintType(client, {
      print_type: null,
      config_preset_id: 'mini12',
    });
    expect(pt).toBe('soft');
    expect(calls).toEqual([{ table: 'config_presets', col: 'slug', val: 'mini12' }]);
  });

  it('section_structure_preset_id приоритетнее config_preset_id', async () => {
    const { client, calls } = mockSupabase({
      presets: { col: 'id', val: 'ss-1', print_type: 'layflat' },
    });
    const pt = await resolveAlbumEffectivePrintType(client, {
      print_type: null,
      section_structure_preset_id: 'ss-1',
      config_preset_id: 'mini12',
    });
    expect(pt).toBe('layflat');
    expect(calls).toEqual([{ table: 'presets', col: 'id', val: 'ss-1' }]);
  });

  it('пресет без типа → дефолт layflat', async () => {
    const { client } = mockSupabase({
      presets: { col: 'id', val: 'ss-1', print_type: null },
    });
    const pt = await resolveAlbumEffectivePrintType(client, {
      print_type: null,
      section_structure_preset_id: 'ss-1',
    });
    expect(pt).toBe('layflat');
  });

  it('album null → layflat без запросов', async () => {
    const { client, calls } = mockSupabase({});
    expect(await resolveAlbumEffectivePrintType(client, null)).toBe('layflat');
    expect(calls).toHaveLength(0);
  });
});
