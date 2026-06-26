/**
 * РЭ.22.9 — семантические поля common-мастера для тест-фикстур.
 *
 * Раньше синтетические common-мастера в тестах задавались как name-only
 * заглушки (page_role:null, slot_capacity:null) — этого хватало by-name выбору.
 * После перехода на by-type (findCommonMaster) мастер выбирается по
 * page_role+ёмкости+page_type, поэтому фикстуры должны нести ТЕ ЖЕ поля, что у
 * РЕАЛЬНЫХ мастеров akvarel/belly (сверено по spread_templates на проде).
 *
 * Маппинг имя → (page_role, slot_capacity, page_type, is_spread) — копия
 * реальных мастеров общего раздела:
 *   J-Full          common  {photos_full:1}     page-any
 *   J-Spread        common  {photos_full:1}     spread (is_spread)
 *   J-Half          common  {photos_half:2}     page-any
 *   J-Quarter       common  {photos_quarter:2}  page-any
 *   J-Quarter-Left  common  {photos_quarter:2}  page-left
 *   J-Quarter-Right common  {photos_quarter:2}  page-right
 *   J-Sixth-6       common  {photos_sixth:6}    page-any
 *   J-Collage-N     common  {photos_collage:N}  page-any
 * Не-common имена (F-*, G-*, E-*, M-*, …) → null/null (как было), их разметку
 * фикстуры задают отдельно.
 */

import type { PageRole, PageType, SlotCapacity } from '@/lib/album-builder/types';

export function commonMasterFields(name: string): {
  page_role: PageRole | null;
  slot_capacity: SlotCapacity | null;
  page_type?: PageType;
  is_spread?: boolean;
} {
  if (name === 'J-Full') {
    return { page_role: 'common', slot_capacity: { photos_full: 1 }, page_type: 'page-any' };
  }
  if (name === 'J-Spread') {
    return { page_role: 'common', slot_capacity: { photos_full: 1 }, page_type: 'spread', is_spread: true };
  }
  if (name === 'J-Half') {
    return { page_role: 'common', slot_capacity: { photos_half: 2 }, page_type: 'page-any' };
  }
  if (name === 'J-Quarter') {
    return { page_role: 'common', slot_capacity: { photos_quarter: 2 }, page_type: 'page-any' };
  }
  if (name === 'J-Quarter-Left') {
    return { page_role: 'common', slot_capacity: { photos_quarter: 2 }, page_type: 'page-left' };
  }
  if (name === 'J-Quarter-Right') {
    return { page_role: 'common', slot_capacity: { photos_quarter: 2 }, page_type: 'page-right' };
  }
  if (name === 'J-Sixth-6') {
    return { page_role: 'common', slot_capacity: { photos_sixth: 6 }, page_type: 'page-any' };
  }
  const collage = name.match(/^J-Collage-(\d+)$/);
  if (collage) {
    return { page_role: 'common', slot_capacity: { photos_collage: Number(collage[1]) }, page_type: 'page-any' };
  }
  return { page_role: null, slot_capacity: null };
}
