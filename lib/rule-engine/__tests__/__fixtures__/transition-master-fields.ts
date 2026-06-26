/**
 * РЭ.22.10 — реальная разметка transition-мастеров для тест-фикстур.
 *
 * До РЭ.22.10 transition выбирал combo/J-chain мастера ПО ИМЕНИ, и фикстуры
 * строились с `page_role: null, slot_capacity: null` (by-name-заточенные).
 * РЭ.22.10 перевёл выбор на семантику (findComboTailMaster + findCommonMaster),
 * поэтому фикстуры дотянуты до РЕАЛЬНЫХ мастеров akvarel/belly (сверено с
 * прод-БД, scratchpad/full-masters.json):
 *
 *   • J-Combined-Tail-N        → student_grid {students:N, photos_full:1} page-left
 *   • J-Combined-Tail-N-Right  → student_grid {students:N, photos_full:1} page-right
 *     (combo хвоста: M слотов учеников + classphoto, БЕЗ крупного портрета —
 *      именно отсутствие has_portrait отличает его от N-Combined-Page)
 *   • J-Half      → common {photos_half:2}   page-any
 *   • J-Full      → common {photos_full:1}   page-any
 *   • J-Sixth-6   → common {photos_sixth:6}  page-any
 *   • J-Collage-N → common {photos_collage:N} page-any
 *
 * Возвращает null для прочих имён — вызывающий makeMaster оставляет свою
 * исходную разметку (гриды/E-Student/Combined-Page работали и до РЭ.22.10,
 * их выбор semantic-finders не трогает).
 */

import type { SpreadTemplate } from '@/lib/album-builder/types';

export interface TransitionMasterFields {
  page_role: SpreadTemplate['page_role'];
  slot_capacity: SpreadTemplate['slot_capacity'];
  page_type: SpreadTemplate['page_type'];
}

export function transitionMasterFields(
  name: string,
): TransitionMasterFields | null {
  // combo хвоста: J-Combined-Tail-<M>[-Right]. Учитываем и опечатку J-J-… как
  // обычное имя (в реале это дефектный мастер с role=null — его в фикстуры не
  // тянем; здесь маппится только корректное каноническое имя).
  const combo = name.match(/^J-Combined-Tail-(\d+)(-Right)?$/);
  if (combo) {
    const students = parseInt(combo[1], 10);
    return {
      page_role: 'student_grid',
      slot_capacity: { students, photos_full: 1 },
      page_type: combo[2] ? 'page-right' : 'page-left',
    };
  }
  if (name === 'J-Half') {
    return { page_role: 'common', slot_capacity: { photos_half: 2 }, page_type: 'page-any' };
  }
  if (name === 'J-Full') {
    return { page_role: 'common', slot_capacity: { photos_full: 1 }, page_type: 'page-any' };
  }
  if (name === 'J-Sixth-6') {
    return { page_role: 'common', slot_capacity: { photos_sixth: 6 }, page_type: 'page-any' };
  }
  const collage = name.match(/^J-Collage-(\d+)$/);
  if (collage) {
    return {
      page_role: 'common',
      slot_capacity: { photos_collage: parseInt(collage[1], 10) },
      page_type: 'page-any',
    };
  }
  return null;
}
