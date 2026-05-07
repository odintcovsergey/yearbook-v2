/**
 * Загрузка template_set из Supabase в формат, который ожидает buildAlbum().
 *
 * Используется:
 *  - В scripts/smoke-album-builder.ts для тестового прогона
 *  - В app/api/layout/route.ts (action=build_album_test) для UI Build Test
 *
 * @param supabase — клиент с правами SELECT на template_sets и spread_templates
 * @param slug — slug template_set'а (по умолчанию 'okeybook-default')
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TemplateSet } from './types';

export async function loadTemplateSet(
  supabase: SupabaseClient,
  slug = 'okeybook-default',
): Promise<TemplateSet> {
  const { data: ts, error: e1 } = await supabase
    .from('template_sets')
    .select('*')
    .eq('slug', slug)
    .single();
  if (e1 || !ts) {
    throw new Error(`template_set ${slug} not found: ${e1?.message ?? 'no row'}`);
  }

  const { data: spreads, error: e2 } = await supabase
    .from('spread_templates')
    .select('*')
    .eq('template_set_id', ts.id)
    .order('sort_order');
  if (e2 || !spreads) {
    throw new Error(`spread_templates for ${slug} not loaded: ${e2?.message ?? 'empty'}`);
  }

  return { ...ts, spreads } as TemplateSet;
}
