/**
 * Smart-fill: чтение реального альбома из БД и сборка AlbumInput для buildAlbum.
 *
 * Архитектурный принцип (см. docs/phase-1-spec.md): тонкая обёртка между БД
 * и builder'ом. Никакой бизнес-логики, никаких ограничений — только маппинг.
 *
 * Возвращает:
 *  - input: AlbumInput — готовый объект для передачи в buildAlbum
 *  - warnings: SmartFillWarning[] — агрегированные предупреждения чтения БД
 *    (отдельно от BuildWarning builder'а)
 *
 * Используется в:
 *  - /tmp/test-build-album-input.ts — одноразовая проверка (не коммитим)
 *  - app/api/layout/route.ts (action=build_album) — endpoint 1.3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPhotoUrl } from '@/lib/supabase';
import type {
  AlbumInput,
  HeadTeacher,
  Subject,
  Student,
  CommonPhotos,
} from '@/lib/album-builder';
import { filterChildrenByPurchase } from './filter-by-purchase';

export type SmartFillWarningCode =
  | 'students_no_portrait'
  | 'per_child_override_ignored'
  | 'non_purchasers_filtered';  // РЭ.25: N учеников с is_purchased=false
                                 // отсечены из личного раздела.

export type SmartFillWarning = {
  code: SmartFillWarningCode;
  detail: string;
};

export type BuildAlbumInputResult = {
  input: AlbumInput;
  warnings: SmartFillWarning[];
};

/**
 * Резолв template_set_id для альбома: если NULL у альбома, ищем глобальный
 * okeybook-default. Копия паттерна из app/api/tenant/route.ts:110.
 */
async function getDefaultTemplateSetId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('template_sets')
    .select('id')
    .eq('slug', 'okeybook-default')
    .is('tenant_id', null)
    .single();
  if (error || !data) return null;
  return data.id;
}

export async function buildAlbumInput(
  supabase: SupabaseClient,
  albumId: string,
): Promise<BuildAlbumInputResult> {
  const { data: album, error: albumErr } = await supabase
    .from('albums')
    .select('id, template_set_id, common_section_max_spreads, include_non_purchasers')
    .eq('id', albumId)
    .single();

  if (albumErr || !album) {
    throw new Error(
      `album ${albumId} not found: ${albumErr?.message ?? 'no row'}`,
    );
  }

  let templateSetId: string | null = album.template_set_id;
  if (!templateSetId) {
    templateSetId = await getDefaultTemplateSetId(supabase);
    if (!templateSetId) {
      throw new Error(
        `album ${albumId} has no template_set_id and no default okeybook-default in DB`,
      );
    }
  }

  const [
    teachersRes,
    childrenRes,
  ] = await Promise.all([
    supabase
      .from('teachers')
      .select('id, full_name, position, description, is_head_teacher')
      .eq('album_id', albumId)
      .order('created_at'),
    supabase
      .from('children')
      .select('id, full_name, class, config_preset_id, is_purchased')
      .eq('album_id', albumId)
      .order('class')
      .order('full_name'),
  ]);

  if (teachersRes.error) {
    throw new Error(`teachers load failed: ${teachersRes.error.message}`);
  }
  if (childrenRes.error) {
    throw new Error(`children load failed: ${childrenRes.error.message}`);
  }

  const teachers = teachersRes.data ?? [];
  const childrenAll = childrenRes.data ?? [];

  // ─── РЭ.25: фильтр не-заказчиков в личном разделе ──────────────────
  // Если album.include_non_purchasers=true → мягкий режим, все
  // ученики получают персональную страницу независимо от is_purchased.
  // Иначе (default false) → строгий режим: дети с is_purchased=false
  // отсекаются ДО формирования AlbumInput.students[].
  //
  // Бэк-совместимость: значения undefined/null трактуем как «по умолчанию».
  // Для is_purchased это значит true (ребёнок участвует) — корректно
  // для случаев, когда миграция БД ещё не применена или БД отдала
  // частичный набор колонок.
  //
  // Архитектурное место фильтра — здесь, ДО входа в buildAlbum.
  // Engine остаётся чистым, не знает про is_purchased. См. spec §4.
  const includeAll =
    (album as { include_non_purchasers?: boolean | null })
      .include_non_purchasers === true;
  const children = filterChildrenByPurchase(childrenAll, includeAll);
  const filteredOutCount = childrenAll.length - children.length;
  // ──────────────────────────────────────────────────────────────────

  const teacherIds = teachers.map((t: any) => t.id);
  const childIds = children.map((c: any) => c.id);

  const [
    teacherPhotoLinksRes,
    selectionsRes,
    textsRes,
    commonPhotosRes,
  ] = await Promise.all([
    teacherIds.length > 0
      ? supabase
          .from('photo_teachers')
          .select('teacher_id, photos(storage_path)')
          .in('teacher_id', teacherIds)
      : Promise.resolve({ data: [], error: null }),
    childIds.length > 0
      ? supabase
          .from('selections')
          .select(
            'child_id, selection_type, created_at, photos(storage_path)',
          )
          .in('child_id', childIds)
          // DESC: first-wins логика ниже выберет самое свежее selection.
          // Без этого если ученик поменял выбор portrait_page, в layout
          // попадает устаревшее (см. docs/internal/2.3.1-instructions.md).
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    childIds.length > 0
      ? supabase
          .from('student_texts')
          .select('child_id, text')
          .in('child_id', childIds)
      : Promise.resolve({ data: [], error: null }),
    // А.2.1 — фото общего раздела: photos.type='common_*' (миграция А.1.1).
    // Родители НЕ голосуют за эти фото, builder сам раскладывает в общий
    // раздел альбома (фаза А.2.2). Ordering: по created_at ASC для
    // стабильности порядка между запусками build_album.
    supabase
      .from('photos')
      .select('id, type, storage_path, filename, created_at')
      .eq('album_id', albumId)
      .in('type', [
        'common_spread',
        'common_full',
        'common_half',
        'common_quarter',
        'common_sixth',
      ])
      .order('created_at', { ascending: true }),
  ]);

  if ((teacherPhotoLinksRes as any).error) {
    throw new Error(
      `photo_teachers load failed: ${(teacherPhotoLinksRes as any).error.message}`,
    );
  }
  if ((selectionsRes as any).error) {
    throw new Error(
      `selections load failed: ${(selectionsRes as any).error.message}`,
    );
  }
  if ((textsRes as any).error) {
    throw new Error(
      `student_texts load failed: ${(textsRes as any).error.message}`,
    );
  }
  if ((commonPhotosRes as any).error) {
    throw new Error(
      `common photos load failed: ${(commonPhotosRes as any).error.message}`,
    );
  }

  const photoByTeacher: Record<string, { storage_path: string }> = {};
  for (const link of (teacherPhotoLinksRes as any).data ?? []) {
    const ph = link.photos;
    if (ph?.storage_path) {
      photoByTeacher[link.teacher_id] = { storage_path: ph.storage_path };
    }
  }

  const portraitByChild: Record<string, { storage_path: string }> = {};
  const friendsByChild: Record<string, { storage_path: string }[]> = {};
  for (const sel of (selectionsRes as any).data ?? []) {
    const ph = sel.photos;
    if (!ph?.storage_path) continue;
    if (sel.selection_type === 'portrait_page' && !portraitByChild[sel.child_id]) {
      portraitByChild[sel.child_id] = { storage_path: ph.storage_path };
    } else if (sel.selection_type === 'group') {
      if (!friendsByChild[sel.child_id]) friendsByChild[sel.child_id] = [];
      friendsByChild[sel.child_id].push({ storage_path: ph.storage_path });
    }
  }

  for (const k of Object.keys(friendsByChild)) {
    if (friendsByChild[k].length > 10) {
      friendsByChild[k] = friendsByChild[k].slice(0, 10);
    }
  }

  const textByChild: Record<string, string> = {};
  for (const t of (textsRes as any).data ?? []) {
    textByChild[t.child_id] = t.text ?? '';
  }

  const headTeacherRow = teachers.find((t: any) => t.is_head_teacher);
  const head_teacher: HeadTeacher | null = headTeacherRow
    ? {
        name: headTeacherRow.full_name ?? '',
        role: headTeacherRow.position ?? '',
        text: headTeacherRow.description ?? '',
        photo: photoByTeacher[headTeacherRow.id]
          ? getPhotoUrl(photoByTeacher[headTeacherRow.id].storage_path)
          : null,
      }
    : null;

  const subjects: Subject[] = teachers
    .filter((t: any) => !t.is_head_teacher)
    .map((t: any) => ({
      name: t.full_name ?? '',
      role: t.position ?? '',
      photo: photoByTeacher[t.id]
        ? getPhotoUrl(photoByTeacher[t.id].storage_path)
        : null,
    }));

  const students: Student[] = children.map((c: any) => ({
    full_name: c.full_name ?? '',
    quote: textByChild[c.id] ?? '',
    portrait: portraitByChild[c.id]
      ? getPhotoUrl(portraitByChild[c.id].storage_path)
      : null,
    friend_photos: (friendsByChild[c.id] ?? []).map((p) =>
      getPhotoUrl(p.storage_path),
    ),
  }));

  // А.2.1 — распределение common_* фото из БД по полям CommonPhotos.
  // Маппинг:
  //   photos.type='common_spread'  → CommonPhotos.spread
  //   photos.type='common_full'    → CommonPhotos.full_class
  //   photos.type='common_half'    → CommonPhotos.half
  //   photos.type='common_quarter' → CommonPhotos.quarter
  //   photos.type='common_sixth'   → CommonPhotos.sixth
  //
  // Поле `collage` оставлено пустым массивом для backward-compat со
  // smoke-tests. В новом коде использовать `sixth`.
  const common_photos: CommonPhotos = {
    spread: [],
    full_class: [],
    half: [],
    quarter: [],
    sixth: [],
    collage: [],
  };
  for (const ph of (commonPhotosRes as any).data ?? []) {
    if (!ph?.storage_path) continue;
    const url = getPhotoUrl(ph.storage_path);
    switch (ph.type) {
      case 'common_spread':  common_photos.spread.push(url); break;
      case 'common_full':    common_photos.full_class.push(url); break;
      case 'common_half':    common_photos.half.push(url); break;
      case 'common_quarter': common_photos.quarter.push(url); break;
      case 'common_sixth':   common_photos.sixth.push(url); break;
      // .in() в запросе уже отфильтровал; default не нужен.
    }
  }

  const input: AlbumInput = {
    template_set_id: templateSetId,
    head_teacher,
    subjects,
    students,
    common_photos,
    // А.4 — лимит количества разворотов в общем разделе (NULL = без лимита).
    common_section_max_spreads:
      (album as { common_section_max_spreads?: number | null }).common_section_max_spreads ?? null,
  };

  const warnings: SmartFillWarning[] = [];

  const studentsNoPortrait = students.filter((s) => !s.portrait).length;
  if (studentsNoPortrait > 0) {
    warnings.push({
      code: 'students_no_portrait',
      detail: `${studentsNoPortrait} из ${students.length} учеников без портрета`,
    });
  }

  const overrideCount = children.filter((c: any) => c.config_preset_id).length;
  if (overrideCount > 0) {
    warnings.push({
      code: 'per_child_override_ignored',
      detail: `${overrideCount} учеников имеют свой пресет — игнорируется на MVP`,
    });
  }

  // РЭ.25: статистика фильтрации не-заказчиков (только если строгий режим
  // и кто-то реально отсечён — пустой warning не плодим).
  if (!includeAll && filteredOutCount > 0) {
    warnings.push({
      code: 'non_purchasers_filtered',
      detail: `${filteredOutCount} учеников с is_purchased=false исключены из личного раздела`,
    });
  }

  return { input, warnings };
}
