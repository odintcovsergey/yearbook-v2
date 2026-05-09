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

export type SmartFillWarningCode =
  | 'students_no_portrait'
  | 'per_child_override_ignored';

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
    .select('id, template_set_id')
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
      .select('id, full_name, class, config_preset_id')
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
  const children = childrenRes.data ?? [];
  const teacherIds = teachers.map((t: any) => t.id);
  const childIds = children.map((c: any) => c.id);

  const [
    teacherPhotoLinksRes,
    selectionsRes,
    textsRes,
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
          .order('created_at')
      : Promise.resolve({ data: [], error: null }),
    childIds.length > 0
      ? supabase
          .from('student_texts')
          .select('child_id, text')
          .in('child_id', childIds)
      : Promise.resolve({ data: [], error: null }),
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

  const common_photos: CommonPhotos = {
    full_class: [],
    half: [],
    quarter: [],
    sixth: [],
    collage: [],
  };

  const input: AlbumInput = {
    template_set_id: templateSetId,
    head_teacher,
    subjects,
    students,
    common_photos,
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

  return { input, warnings };
}
