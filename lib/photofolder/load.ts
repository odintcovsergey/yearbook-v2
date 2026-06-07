/**
 * Загрузка данных для сборки фотопапки из Supabase — мост между заказом и
 * чистым модулем lib/photofolder/assemble.ts (как lib/cover/load-covers.ts и
 * lib/smart-fill/build-album-input.ts для альбома).
 *
 * Фотопапка-заказ = строка albums с дизайном (template_set) типа
 * product_type='photofolder'. Создаётся тем же потоком, что и альбом.
 *
 * Тонкая обёртка: только маппинг БД → PhotofolderInput, без бизнес-логики.
 *
 * НЕ покрыто юнит-тестами (как load-covers / build-album-input — это DB-glue).
 * Живой прогон — когда дизайнер пришлёт IDML фотопапки, мастера появятся в
 * spread_templates и можно будет собрать реальную папку. Провизорные места
 * (имена меток — в types.ts LABELS; панель слота — assignPanel ниже;
 * категория групповых фото; режим персонализации) помечены TODO.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPhotoUrl } from '@/lib/supabase';
import type { HeadTeacher, Photo, Student, Subject } from '../album-builder/types';
import { assemblePhotofolder } from './assemble';
import type {
  PhotofolderInput,
  PhotofolderMaster,
  PhotofolderMode,
  PhotofolderResult,
  PhotofolderShared,
  PhotofolderSlot,
} from './types';

export type LoadAlbumPhotofolderResult = {
  result: PhotofolderResult;
  /** Предупреждения уровня чтения БД (отдельно от result.warnings сборки). */
  warnings: string[];
};

/**
 * Панель слота. Если в плейсхолдере уже сохранена панель (будущая запись при
 * загрузке IDML через computePanelZones) — берём её. Иначе выводим из центра
 * по x: делим ширину мастера на panelCount равных панелей. Провизорный fallback
 * до того, как upload начнёт хранить точную панель из геометрии страниц.
 */
function assignPanel(
  ph: { label?: string; x_mm?: number; width_mm?: number; panel?: number },
  masterWidthMm: number,
  panelCount: number,
): number | undefined {
  if (typeof ph.panel === 'number') return ph.panel;
  if (masterWidthMm <= 0 || typeof ph.x_mm !== 'number') return undefined;
  const centerX = ph.x_mm + (ph.width_mm ?? 0) / 2;
  const band = masterWidthMm / panelCount;
  const idx = Math.floor(centerX / band);
  return Math.max(0, Math.min(panelCount - 1, idx));
}

/** Маппит строки spread_templates в мастера фотопапки (по 3 панели). */
function toMasters(
  rows: Array<Record<string, unknown>>,
  warnings: string[],
): PhotofolderMaster[] {
  const PANELS = 3; // тримо; двойная папка (2) — позже, см. memory project_photofolder
  return rows.map((row, idx) => {
    const widthMm = Number(row.width_mm) || 0;
    const placeholders = Array.isArray(row.placeholders)
      ? (row.placeholders as Array<Record<string, unknown>>)
      : [];
    const slots: PhotofolderSlot[] = placeholders
      .filter((p) => typeof p.label === 'string')
      .map((p) => ({
        label: (p.label as string).toLowerCase(),
        panel: assignPanel(p as never, widthMm, PANELS),
      }));
    return {
      id: String(row.id),
      name: String(row.name ?? ''),
      // spread_index по порядку sort_order: первый мастер = разворот 1.
      spread_index: idx,
      slots,
    };
  });
}

export async function loadAlbumPhotofolder(
  supabase: SupabaseClient,
  albumId: string,
): Promise<LoadAlbumPhotofolderResult> {
  const warnings: string[] = [];

  // ── 1. Заказ ──────────────────────────────────────────────────────────────
  const { data: album, error: albumErr } = await supabase
    .from('albums')
    .select('id, title, classes, city, year, school_name, tenant_id, template_set_id')
    .eq('id', albumId)
    .single();
  if (albumErr || !album) {
    throw new Error(`album ${albumId} not found: ${albumErr?.message ?? 'no row'}`);
  }
  const a = album as unknown as Record<string, unknown>;
  const templateSetId = (a.template_set_id as string | null) ?? null;
  if (!templateSetId) {
    throw new Error(`album ${albumId} has no template_set_id`);
  }

  // TODO: режим персонализации пока без своего поля в albums — добавим
  // миграцией позже (albums.photofolder_mode). До этого — базовый режим.
  const mode: PhotofolderMode = 'portrait_personal';

  // ── 2. Дизайн: проверяем тип + грузим мастера ─────────────────────────────
  const { data: tsRow } = await supabase
    .from('template_sets')
    .select('id, product_type')
    .eq('id', templateSetId)
    .single();
  if ((tsRow as { product_type?: string } | null)?.product_type !== 'photofolder') {
    warnings.push(
      `дизайн ${templateSetId} не помечен product_type='photofolder' — собираем как фотопапку всё равно`,
    );
  }

  const { data: mastersRaw } = await supabase
    .from('spread_templates')
    .select('id, name, sort_order, width_mm, placeholders')
    .eq('template_set_id', templateSetId)
    .order('sort_order', { ascending: true });
  const masters = toMasters((mastersRaw ?? []) as Array<Record<string, unknown>>, warnings);
  if (masters.length < 2) {
    warnings.push(
      `в дизайне фотопапки ${masters.length} мастеров (ожидается 2: внешний + внутренний разворот)`,
    );
  }

  // ── 3. Учителя + ученики ──────────────────────────────────────────────────
  const [teachersRes, childrenRes] = await Promise.all([
    supabase
      .from('teachers')
      .select('id, full_name, position, description, is_head_teacher')
      .eq('album_id', albumId)
      .order('created_at'),
    supabase
      .from('children')
      .select('id, full_name, class')
      .eq('album_id', albumId)
      .order('class')
      .order('full_name'),
  ]);
  if (teachersRes.error) throw new Error(`teachers load failed: ${teachersRes.error.message}`);
  if (childrenRes.error) throw new Error(`children load failed: ${childrenRes.error.message}`);
  const teachers = (teachersRes.data ?? []) as Array<Record<string, unknown>>;
  const children = (childrenRes.data ?? []) as Array<{ id: string; full_name: string; class: string }>;

  const teacherIds = teachers.map((t) => t.id as string);
  const childIds = children.map((c) => c.id);

  // ── 4. Фото: портреты учеников, фото учителей, групповые ──────────────────
  const [teacherPhotosRes, selectionsRes, groupPhotosRes] = await Promise.all([
    teacherIds.length > 0
      ? supabase.from('photo_teachers').select('teacher_id, photos(storage_path)').in('teacher_id', teacherIds)
      : Promise.resolve({ data: [], error: null }),
    childIds.length > 0
      ? supabase
          .from('selections')
          .select('child_id, selection_type, created_at, photos(storage_path)')
          .in('child_id', childIds)
          .eq('selection_type', 'portrait_page')
          .order('created_at', { ascending: false }) // first-wins = самое свежее
      : Promise.resolve({ data: [], error: null }),
    // Групповые фото класса (разворот 1). TODO: уточнить категорию по реальному
    // IDML; пока берём 'group' и 'common_full' (общее фото класса).
    supabase
      .from('photos')
      .select('storage_path, type, created_at')
      .eq('album_id', albumId)
      .in('type', ['group', 'common_full'])
      .order('created_at', { ascending: true }),
  ]);

  const photoByTeacher: Record<string, string> = {};
  for (const link of ((teacherPhotosRes as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>) {
    const ph = link.photos as { storage_path?: string } | null;
    if (ph?.storage_path) photoByTeacher[link.teacher_id as string] = getPhotoUrl(ph.storage_path);
  }

  const portraitByChild: Record<string, string> = {};
  for (const sel of ((selectionsRes as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>) {
    const ph = sel.photos as { storage_path?: string } | null;
    const cid = sel.child_id as string;
    if (ph?.storage_path && !portraitByChild[cid]) portraitByChild[cid] = getPhotoUrl(ph.storage_path);
  }

  const group_photos: Photo[] = [];
  for (const ph of ((groupPhotosRes as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>) {
    const sp = ph.storage_path as string | undefined;
    if (sp) group_photos.push(getPhotoUrl(sp));
  }

  // ── 5. Вход модуля ────────────────────────────────────────────────────────
  const headRow = teachers.find((t) => t.is_head_teacher);
  const head_teacher: HeadTeacher | null = headRow
    ? {
        name: (headRow.full_name as string) ?? '',
        role: (headRow.position as string) ?? '',
        text: (headRow.description as string) ?? '',
        photo: photoByTeacher[headRow.id as string] ?? null,
      }
    : null;

  const subjects: Subject[] = teachers
    .filter((t) => !t.is_head_teacher)
    .map((t) => ({
      name: (t.full_name as string) ?? '',
      role: (t.position as string) ?? '',
      photo: photoByTeacher[t.id as string] ?? null,
    }));

  const students: Student[] = children.map((c) => ({
    full_name: c.full_name ?? '',
    quote: '',
    portrait: portraitByChild[c.id] ?? null,
    friend_photos: [],
  }));

  const classes = Array.isArray(a.classes) ? (a.classes as string[]).join(', ') : null;
  const shared: PhotofolderShared = {
    title: (a.title as string | null) ?? null,
    school_name: (a.school_name as string | null) ?? null,
    city: (a.city as string | null) ?? null,
    year: a.year != null ? String(a.year) : null,
    classes: classes || null,
    cover_common_photo_url: null, // общее фото на обложку — подключим на рендере
  };

  const input: PhotofolderInput = {
    mode,
    masters,
    head_teacher,
    subjects,
    students,
    group_photos,
    shared,
  };

  const result = assemblePhotofolder(input);

  // child_id: instances идут в порядке input.students = порядок children.
  if (children.length > 0) {
    result.instances.forEach((inst, i) => {
      inst.child_id = children[i]?.id ?? null;
    });
  }

  return { result, warnings };
}
