/**
 * Загрузка профиля экспорта по slug — для воркера очереди (у него нет
 * AuthContext, поэтому без ролевой фильтрации роута). slug уникален в
 * export_profiles, берём enabled-профиль (глобальный или тенанта).
 */
import { supabaseAdmin } from '@/lib/supabase'
import type { ExportProfile } from '@/lib/pdf-export'
import { mapExportProfile } from './profile'

export async function loadExportProfileBySlug(
  slug: string,
  tenantId: string | null,
): Promise<ExportProfile | null> {
  const { data } = await supabaseAdmin
    .from('export_profiles')
    .select('*')
    .eq('slug', slug)
    .eq('enabled', true)
    // глобальный (tenant_id IS NULL) или принадлежащий тенанту альбома
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId ?? '00000000-0000-0000-0000-000000000000'}`)
    .maybeSingle()
  if (!data) return null
  return mapExportProfile(data as Record<string, unknown>)
}
