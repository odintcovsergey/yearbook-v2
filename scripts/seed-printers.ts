/**
 * Наполнение профилей 4 типографий (ТЗ tz-printer-profile, §5).
 *
 * Данные печати из справочника типографий. ВАЖНО: числовые значения
 * параметрические — Сергей сверит со справочником и поправит в UI
 * (супер-админка → Печать). Точные диапазоны корешка / work-зоны / px для
 * форматов без явных данных оставлены заглушками (0 или примерные).
 *
 * Создаёт ГЛОБАЛЬНЫЕ типографии (tenant_id = NULL, is_global = true).
 *
 * Идемпотентность: типографию с таким же именем НЕ трогаем (чтобы повторный
 * запуск не затирал ручные правки Сергея). Вставляем только отсутствующие.
 *
 * ЗАПУСК (Сергей, локально, с настоящим .env.local):
 *   Сухой прогон:   node --env-file=.env.local --import tsx scripts/seed-printers.ts
 *   Реальная вставка: node --env-file=.env.local --import tsx scripts/seed-printers.ts --apply
 *
 * ОТКАТ (Supabase Studio SQL Editor):
 *   delete from printers where is_global and name in
 *     ('Фабрика Фотокниги','Булгак','Принт Мейтс','Окей Книга');
 */

import { supabaseAdmin } from '../lib/supabase'
import type { PrinterConfig, PrinterFormat, FormatFamily, PrinterSpine } from '../lib/printers/types'

const APPLY = process.argv.includes('--apply')

/** Хелпер формата: остальные поля по умолчанию 0 (Сергей сверит). */
function fmt(p: Partial<PrinterFormat> & { id: string; name: string; family: FormatFamily }): PrinterFormat {
  return {
    page_w_mm: 0, page_h_mm: 0, spread_w_px: 0, spread_h_px: 0,
    work_w_mm: 0, work_h_mm: 0, bleed_mm: 0, safe_mm: 0,
    ...p,
  }
}

const rangesSpine = (ranges: PrinterSpine['ranges']): PrinterSpine => ({ mode: 'ranges', ranges })
const formulaSpine = (base_mm: number, step_mm: number, per_spreads: number): PrinterSpine =>
  ({ mode: 'formula', formula: { base_mm, step_mm, per_spreads } })
const fixedSpine = (fixed_mm: number): PrinterSpine => ({ mode: 'fixed', fixed_mm })

type Seed = { name: string; config: PrinterConfig }

const SEEDS: Seed[] = [
  // ── Фабрика Фотокниги: приём разворотами, JPEG/sRGB ──
  {
    name: 'Фабрика Фотокниги',
    config: {
      accept_mode: 'spread', file_format: 'jpeg', color: 'srgb',
      cover: { flap_lr_mm: 18, flap_tb_mm: 17 },
      formats: [
        fmt({ id: '20x20', name: '20×20', family: 'square',
          page_w_mm: 200, page_h_mm: 200, spread_w_px: 4724, spread_h_px: 2398,
          work_w_mm: 394, work_h_mm: 197, bleed_mm: 3, safe_mm: 3 }),
        fmt({ id: '21x30', name: '21×30', family: 'vertical_rect',
          page_w_mm: 210, page_h_mm: 300, spread_w_px: 4913, spread_h_px: 3496,
          work_w_mm: 410, work_h_mm: 290, bleed_mm: 3, safe_mm: 3 }),
      ],
      // Диапазоны корешка по типам листа — ЗАГЛУШКИ, сверить со справочником ФФ.
      sheet_types: [
        { id: 'paper_plain', name: 'Бумага без прослойки', spine: rangesSpine([
          { min_spreads: 0, max_spreads: 10, spine_mm: 5 },
          { min_spreads: 11, max_spreads: 20, spine_mm: 8 },
          { min_spreads: 21, max_spreads: 40, spine_mm: 12 },
        ]) },
        { id: 'cardboard', name: 'Картон', spine: rangesSpine([
          { min_spreads: 0, max_spreads: 10, spine_mm: 9 },
          { min_spreads: 11, max_spreads: 20, spine_mm: 14 },
          { min_spreads: 21, max_spreads: 40, spine_mm: 20 },
        ]) },
        { id: 'cardboard_pad', name: 'Картон + прослойка', spine: rangesSpine([
          { min_spreads: 0, max_spreads: 10, spine_mm: 12 },
          { min_spreads: 11, max_spreads: 20, spine_mm: 18 },
          { min_spreads: 21, max_spreads: 40, spine_mm: 26 },
        ]) },
      ],
    },
  },

  // ── Булгак: разворотами, JPEG/sRGB; корешок formula (+1мм/разворот) ──
  {
    name: 'Булгак',
    config: {
      accept_mode: 'spread', file_format: 'jpeg', color: 'srgb',
      cover: { flap_lr_mm: 15, flap_tb_mm: 15 },
      formats: [
        fmt({ id: '20x20', name: '20×20', family: 'square', page_w_mm: 200, page_h_mm: 200, bleed_mm: 5, safe_mm: 10 }),
        fmt({ id: '22x22', name: '22×22', family: 'square', page_w_mm: 220, page_h_mm: 220, bleed_mm: 5, safe_mm: 10 }),
        fmt({ id: '22x30', name: '22×30', family: 'vertical_rect',
          page_w_mm: 220, page_h_mm: 300, spread_w_px: 5339, spread_h_px: 3602, bleed_mm: 5, safe_mm: 10 }),
        fmt({ id: '30x20', name: '30×20', family: 'horizontal', page_w_mm: 300, page_h_mm: 200, bleed_mm: 5, safe_mm: 10 }),
        fmt({ id: '30x30', name: '30×30', family: 'square', page_w_mm: 300, page_h_mm: 300, bleed_mm: 5, safe_mm: 10 }),
      ],
      // base_mm — ЗАГЛУШКА, сверить; шаг +1мм за 1 разворот.
      sheet_types: [
        { id: 'standard', name: 'Стандарт', spine: formulaSpine(4, 1, 1) },
      ],
    },
  },

  // ── Принт Мейтс: разворотами, JPEG/sRGB; корешок fixed = 0 ──
  {
    name: 'Принт Мейтс',
    config: {
      accept_mode: 'spread', file_format: 'jpeg', color: 'srgb',
      // bleed/safe — нет данных, заглушка 3/10 (ждём дизайнера).
      formats: [
        fmt({ id: 'a4', name: 'A4', family: 'vertical_rect',
          page_w_mm: 210, page_h_mm: 297, spread_w_px: 4913, spread_h_px: 3496, bleed_mm: 3, safe_mm: 10 }),
        fmt({ id: '16x23', name: '16×23', family: 'vertical_rect', page_w_mm: 160, page_h_mm: 230, bleed_mm: 3, safe_mm: 10 }),
        fmt({ id: '23x30', name: '23×30', family: 'vertical_rect',
          page_w_mm: 230, page_h_mm: 300, spread_w_px: 5339, spread_h_px: 3402, bleed_mm: 3, safe_mm: 10 }),
        fmt({ id: '23x23', name: '23×23', family: 'square', page_w_mm: 230, page_h_mm: 230, bleed_mm: 3, safe_mm: 10 }),
      ],
      sheet_types: [
        { id: 'no_spine', name: 'Без корешка', spine: fixedSpine(0) },
      ],
    },
  },

  // ── Окей Книга: приём ПОСТРАНИЧНО, файл может быть PDF; корешок fixed ──
  {
    name: 'Окей Книга',
    config: {
      accept_mode: 'page', file_format: 'pdf', color: 'srgb',
      formats: [
        fmt({ id: '22x28', name: '22×28', family: 'vertical_rect', page_w_mm: 220, page_h_mm: 280, bleed_mm: 5, safe_mm: 20 }),
        fmt({ id: '27x27', name: '27×27', family: 'square', page_w_mm: 270, page_h_mm: 270, bleed_mm: 5, safe_mm: 20 }),
      ],
      // fixed_mm — ЗАГЛУШКА, сверить со справочником ОкейКнига.
      sheet_types: [
        { id: 'fixed', name: 'Стандартный корешок', spine: fixedSpine(8) },
      ],
    },
  },
]

async function main() {
  console.log(`\nРежим: ${APPLY ? '⚠️  APPLY (пишу в БД)' : 'СУХОЙ ПРОГОН (ничего не пишу)'}`)
  console.log('NB: значения параметрические — сверьте со справочником и поправьте в UI (Печать).')

  const { data: existing, error: exErr } = await supabaseAdmin
    .from('printers')
    .select('id, name')
    .is('tenant_id', null)
  if (exErr) { console.error('✗ Ошибка чтения printers:', exErr.message); process.exit(1) }
  const seen = new Set((existing ?? []).map((r: { name: string }) => r.name.trim()))
  console.log(`Уже есть глобальных типографий: ${seen.size}. Совпадающие по имени пропустим.`)

  const rows = SEEDS
    .filter((s) => !seen.has(s.name.trim()))
    .map((s) => ({ tenant_id: null, is_global: true, name: s.name, config: s.config }))

  for (const s of SEEDS) {
    console.log(`  ${seen.has(s.name.trim()) ? '⏭  есть' : '➕ новая'}: ${s.name} `
      + `(форматов ${s.config.formats?.length ?? 0}, типов листа ${s.config.sheet_types.length}, `
      + `корешок ${s.config.sheet_types.map((t) => t.spine?.mode).join('/')})`)
  }

  if (rows.length === 0) { console.log('\nНовых типографий нет — всё уже есть.\n'); return }
  if (!APPLY) { console.log(`\nК вставке: ${rows.length}. Для записи — флаг --apply.\n`); return }

  const { error: insErr } = await supabaseAdmin.from('printers').insert(rows)
  if (insErr) { console.error('\n✗ Ошибка вставки:', insErr.message); process.exit(1) }
  console.log(`\n✓ Готово. Вставлено ${rows.length} типографий. Сверьте значения в UI.\n`)
}

main().catch((e) => { console.error('\n✗ Скрипт упал:', e); process.exit(1) })
