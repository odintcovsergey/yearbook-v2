'use client'

import { useEffect, useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { SpreadInstance, SpreadTemplate } from '@/lib/album-builder/types'
import { api } from '@/lib/api-client'
import {
  resolveBackgrounds,
  type SpreadBackgroundInput,
  type BackgroundPoolRow,
} from '@/lib/backgrounds/resolve-background'
import type { PrinterFormat } from '@/lib/printers/types'
import { adaptTemplateToFormat, resolveDesignFamily } from '@/lib/format-adapt'

// Dynamic import: AlbumSpreadCanvas использует window.Image (Konva), SSR-incompatible.
const AlbumSpreadCanvas = dynamic(
  () => import('./AlbumSpreadCanvas'),
  { ssr: false, loading: () => null },
)

// ─── Минимальный publicный contract layout'а (не SmartFillLayout) ────────
// Принимаем layout с конкретными полями которые нужны компоненту, без
// необходимости тащить SmartFillLayout (он определён в page.tsx).
type LayoutShape = {
  template_set_id: string
  spreads: unknown[]  // narrowing к SpreadInstance[] делаем внутри
  // РЭ.43.B: для soft binding превью должно показывать первый разворот
  // как [форзац, soft_intro], а не парить intro со следующей student-страницей.
  // Поле опциональное для обратной совместимости со старым shape.
  summary?: { sheet_type?: 'hard' | 'soft' | null }
}

type Props = {
  layout: LayoutShape
  onOpenEditor: () => void
  /**
   * РЭ.43.B.3: fallback на album.print_type если layout.summary.sheet_type
   * отсутствует. Это происходит для legacy-layout'ов сохранённых в БД до
   * РЭ.43.B (когда sheet_type не клался в summary). Без этого fallback'а
   * при повторном открытии заказа форзацы не показывались, пока партнёр
   * не нажмёт «Пересобрать».
   */
  albumPrintType?: 'hard' | 'soft' | null
  /**
   * ТЗ 19.06.2026: формат заказа (PrinterFormat) для адаптации превью под формат
   * типографии. null/undefined → родной формат дизайна (как было).
   */
  targetFormat?: PrinterFormat | null
}

type TemplateDetailResponse = {
  template_set: {
    id: string
    page_width_mm: number
    page_height_mm: number
    spread_width_mm: number
    spread_height_mm: number
    default_background_url: string | null
    /** Модель «поля»: отступ контента от корешка (мм). null = legacy зеркало. */
    spine_margin_mm: number | null
    /** Семейство пропорций дизайна (ТЗ 19.06.2026). null → авто по пропорции. */
    format_family: 'vertical_rect' | 'square' | 'horizontal' | null
  }
  spread_templates: SpreadTemplate[]
  /** Пул категорийных фонов набора (для ротации). */
  backgrounds?: BackgroundPoolRow[]
}

const TARGET_HEIGHT_PX = 175  // см. инструкцию 2.3 «Размер миниатюр»

// ─── Визуальный разворот ──────────────────────────────────────────────────
//
// VisualSpread — одна клетка в превью. Может содержать:
//   - двухстраничный мастер (один SpreadInstance занимает обе половины)
//   - два одностраничных (левая + правая страницы независимыми мастерами)
//   - один одностраничный (нечётность — другая половина пустая)
//   - S-Intro в soft (одна правая страница, левая пустая)
//
// Группировка: см. groupIntoVisualSpreads ниже.
type VisualSpread =
  | { kind: 'full_spread'; instance: SpreadInstance }
  | {
      kind: 'pair'
      left: SpreadInstance | null
      right: SpreadInstance | null
      /** Уникальный key для React (берём spread_index левого или правого). */
      key: number
    }

// ─── Хелпер: API-fetch с auto-refresh JWT (см. lib/api-client.ts) ──
async function fetchTemplateDetail(templateSetId: string): Promise<TemplateDetailResponse> {
  const r = await api(
    `/api/layout?action=template_set_detail&id=${templateSetId}`,
  )
  if (!r.ok) {
    throw new Error(`template_set_detail failed: ${r.status}`)
  }
  return r.json()
}

/**
 * Группирует SpreadInstance'ы в визуальные развороты.
 *
 * Правила:
 *   1. Двухстраничный мастер (is_spread=true) → kind='full_spread', одна клетка.
 *   2. Два одностраничных подряд → kind='pair', одна клетка с left+right.
 *   3. Нечётный одностраничный (последний в серии или одиночный) → kind='pair'
 *      с одним из left/right = null.
 *   4. РЭ.43.B: для soft binding (sheetType='soft') первый одностраничный
 *      идёт как правая страница первого разворота (форзац слева), если
 *      у него НЕ выставлен section_start. До РЭ.43.B детекция была по
 *      имени мастера 'S-Intro', что не работало для override-мастеров из
 *      РЭ.42 (партнёр выбрал свой J-Teachers / F-Head вместо classphoto).
 *      Теперь решение принимается по sheetType — корректно для любого
 *      мастера.
 *
 *      Аналогично для soft_final последняя страница встаёт LEFT нового
 *      spread — но это обеспечивается через section_start=true, который
 *      приходит в spread с сервера (SECTIONS_THAT_START_NEW_SPREAD).
 *
 * Вход: spreads (от buildAlbum), templateById (для проверки is_spread).
 *       sheetType — 'soft' | 'hard' | null (null = старое поведение).
 * Выход: массив VisualSpread в том же порядке.
 */
function groupIntoVisualSpreads(
  spreads: SpreadInstance[],
  templateById: Map<string, SpreadTemplate>,
  sheetType: 'hard' | 'soft' | null | undefined,
): VisualSpread[] {
  const result: VisualSpread[] = []
  let pending: SpreadInstance | null = null
  const isSoft = sheetType === 'soft'

  for (let idx = 0; idx < spreads.length; idx++) {
    const s = spreads[idx]
    const tmpl = templateById.get(s.template_id)
    // Если шаблон неизвестен (битый layout) — рендерим как одиночную пару,
    // не пытаемся скрестить с соседями. Пользователь увидит «Шаблон не найден».
    if (!tmpl) {
      if (pending) {
        result.push({ kind: 'pair', left: pending, right: null, key: pending.spread_index })
        pending = null
      }
      result.push({ kind: 'pair', left: s, right: null, key: s.spread_index })
      continue
    }

    if (tmpl.is_spread) {
      // Двухстраничный мастер. Если перед ним висит непарный одностраничный —
      // флашим его как одиночку.
      if (pending) {
        result.push({ kind: 'pair', left: pending, right: null, key: pending.spread_index })
        pending = null
      }
      result.push({ kind: 'full_spread', instance: s })
      continue
    }

    // РЭ.43.B: soft binding — самая первая страница (idx=0) НЕ имеющая
    // section_start ложится на R первого разворота (форзац на L). Это
    // согласовано с engine'овской группировкой в
    // lib/rule-engine/build-from-section-structure.ts:255+ для soft.
    //
    // Если у первой страницы section_start=true (что бывает когда первой
    // секцией стоит SECTIONS_THAT_START_NEW_SPREAD типа common_required) —
    // soft-сдвиг НЕ применяется, идём по обычному пути (станет L pending).
    const isFirstAndSoft = isSoft && idx === 0 && pending === null
    const hasSectionStart = (s as unknown as { section_start?: boolean }).section_start === true
    if (isFirstAndSoft && !hasSectionStart) {
      result.push({ kind: 'pair', left: null, right: s, key: s.spread_index })
      continue
    }

    // Обычный одностраничный мастер. Парим с предыдущим pending или ждём пары.
    if (pending) {
      result.push({ kind: 'pair', left: pending, right: s, key: pending.spread_index })
      pending = null
    } else {
      pending = s
    }
  }

  // Финал: оставшийся непарный одностраничный — одиночка слева.
  // Это случай common_right_page_empty (А.2.2.b): фотограф загрузил нечётное
  // число фото общего раздела, последняя группа без пары. Logically — левая
  // страница занята, правая пустая. Для soft binding с soft_final это
  // тоже корректно: финальная страница остаётся на левой, форзац справа.
  if (pending) {
    result.push({ kind: 'pair', left: pending, right: null, key: pending.spread_index })
  }

  return result
}

export default function LayoutPreviewStrip({ layout, onOpenEditor, albumPrintType, targetFormat }: Props) {
  const [detail, setDetail] = useState<TemplateDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchTemplateDetail(layout.template_set_id)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить шаблон')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [layout.template_set_id])

  // Map id → SpreadTemplate для O(1) lookup'а внутри map'а миниатюр.
  const templateById = useMemo(() => {
    const m = new Map<string, SpreadTemplate>()
    if (!detail) return m
    for (const t of detail.spread_templates) m.set(t.id, t)
    return m
  }, [detail])

  const spreads = layout.spreads as SpreadInstance[]

  // ТЗ 19.06.2026: адаптация под формат заказа. Для каждого мастера считаем
  // адаптированный template (размеры + слоты под целевой формат) ОДИН раз.
  // Группировку (is_spread) делаем по ОРИГИНАЛЬНым мастерам — она не меняется.
  const adaptById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof adaptTemplateToFormat>>()
    if (!detail) return m
    const ts = detail.template_set
    const source = {
      pageWidthMm: ts.page_width_mm,
      pageHeightMm: ts.page_height_mm,
      family: resolveDesignFamily(ts),
    }
    for (const t of detail.spread_templates) {
      m.set(t.id, adaptTemplateToFormat(t, source, targetFormat ?? null))
    }
    return m
  }, [detail, targetFormat])
  const renderTmpl = (id: string): SpreadTemplate | null =>
    adaptById.get(id)?.template ?? templateById.get(id) ?? null
  const scaleOf = (id: string): number => adaptById.get(id)?.scale ?? 1
  // Предупреждение о несовместимом семействе (показываем один раз).
  const incompatibleWarning = useMemo(() => {
    const found = Array.from(adaptById.values()).find((r) => r.status === 'incompatible')
    return found && found.status === 'incompatible' ? found.warning : null
  }, [adaptById])

  // Визуальные развороты — пересчитываются когда обновляются spreads или шаблоны.
  // РЭ.43.B.3: sheet_type приоритетно из summary (свежие layout'ы) с
  // fallback на album.print_type (legacy layout'ы сохранённые до РЭ.43.B
  // в которых summary.sheet_type не было).
  const sheetType = layout.summary?.sheet_type ?? albumPrintType ?? null
  // Модель «поля»: отступ от корешка набора (для AlbumSpreadCanvas).
  const spineMarginMm = detail?.template_set.spine_margin_mm ?? null
  const visualSpreads = useMemo(
    () => (detail ? groupIntoVisualSpreads(spreads, templateById, sheetType) : []),
    [spreads, templateById, detail, sheetType],
  )

  // Категорийные фоны: public URL фона на КАЖДЫЙ визуальный разворот (тот же
  // резолвер, что в редакторе). Категория — по ведущей странице (для пары —
  // левая, иначе правая; для full_spread — сам мастер). Fallback на
  // default_background_url сохранён.
  const bgUrls = useMemo<(string | null)[]>(() => {
    if (!detail) return []
    const defaultPath = detail.template_set.default_background_url ?? null
    const pool = detail.backgrounds ?? []
    const inputs: SpreadBackgroundInput[] = visualSpreads.map((vs) => {
      const page = vs.kind === 'full_spread' ? vs.instance : (vs.left ?? vs.right)
      const master = page ? templateById.get(page.template_id) : undefined
      return {
        leadingPageRole: master?.page_role ?? null,
        sectionType: page?.section_type ?? null,
        masterOverrideUrl: master?.background_override_url ?? null,
        albumOverrideUrl: page?.data?.['__bg__'] ?? null,
      }
    })
    const paths = resolveBackgrounds(inputs, pool, defaultPath)
    return paths.map((p) =>
      p
        ? p.startsWith('http')
          ? p
          : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/template-backgrounds/${p}`
        : null,
    )
  }, [detail, visualSpreads, templateById])

  return (
    <div className="bg-muted rounded-lg p-3 mb-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="text-xs text-muted-foreground uppercase">
          Превью разворотов ({visualSpreads.length})
        </div>
        <button
          type="button"
          onClick={onOpenEditor}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 transition cursor-pointer"
        >
          Открыть редактор
        </button>
      </div>

      {incompatibleWarning && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-2">
          ⚠️ {incompatibleWarning}
        </div>
      )}

      {loading && (
        <div className="text-xs text-muted-foreground py-4">Загружаем шаблон…</div>
      )}

      {error && (
        <div className="text-xs text-red-600 py-4">{error}</div>
      )}

      {!loading && !error && detail && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {visualSpreads.map((vs, idx) => {
            // Рендер двухстраничного мастера — одна клетка с одним canvas
            if (vs.kind === 'full_spread') {
              const tmpl = renderTmpl(vs.instance.template_id)
              if (!tmpl) {
                return (
                  <div
                    key={vs.instance.spread_index}
                    className="flex-shrink-0 w-[350px] h-[175px] border border-red-200 bg-red-50 flex items-center justify-center text-xs text-red-500"
                  >
                    Шаблон не найден
                  </div>
                )
              }
              const containerWidth = (tmpl.width_mm / tmpl.height_mm) * TARGET_HEIGHT_PX
              return (
                <div key={vs.instance.spread_index} className="flex-shrink-0">
                  <div className="bg-card rounded shadow-sm border border-border">
                    <AlbumSpreadCanvas
                      instance={vs.instance}
                      template={tmpl}
                      containerWidth={containerWidth}
                      mode="preview"
                      backgroundUrl={bgUrls[idx] ?? null}
                      pageSide="spread"
                      spineMarginMm={spineMarginMm == null ? null : spineMarginMm * scaleOf(vs.instance.template_id)}
                    />
                  </div>
                  <div className="text-[10px] text-center text-muted-foreground mt-1">
                    {idx + 1}
                  </div>
                </div>
              )
            }

            // Рендер пары одностраничных мастеров (или одиночки с пустой стороной)
            const leftTmpl = vs.left ? renderTmpl(vs.left.template_id) : null
            const rightTmpl = vs.right ? renderTmpl(vs.right.template_id) : null

            // Ширина каждой половины — на основании первого доступного шаблона
            const refTmpl = leftTmpl ?? rightTmpl
            const halfWidth = refTmpl
              ? (refTmpl.width_mm / refTmpl.height_mm) * TARGET_HEIGHT_PX
              : TARGET_HEIGHT_PX * 0.7  // fallback на случай если оба null (не должно случаться)

            return (
              <div key={vs.key} className="flex-shrink-0">
                <div className="bg-card rounded shadow-sm border border-border flex">
                  {/* Левая страница */}
                  {vs.left && leftTmpl ? (
                    <AlbumSpreadCanvas
                      instance={vs.left}
                      template={leftTmpl}
                      containerWidth={halfWidth}
                      mode="preview"
                      backgroundUrl={bgUrls[idx] ?? null}
                      pageSide="left"
                      spineMarginMm={spineMarginMm == null || !vs.left ? spineMarginMm : spineMarginMm * scaleOf(vs.left.template_id)}
                    />
                  ) : (
                    <ForzacOrEmptySlot
                      width={halfWidth}
                      height={TARGET_HEIGHT_PX}
                      side="left"
                      // РЭ.43.B.2: левый форзац — для soft binding на первом
                      // визуальном развороте (idx=0), когда left=null.
                      isForzac={sheetType === 'soft' && idx === 0}
                    />
                  )}
                  {/* Правая страница */}
                  {vs.right && rightTmpl ? (
                    <AlbumSpreadCanvas
                      instance={vs.right}
                      template={rightTmpl}
                      containerWidth={halfWidth}
                      mode="preview"
                      backgroundUrl={bgUrls[idx] ?? null}
                      pageSide="right"
                      spineMarginMm={spineMarginMm == null || !vs.right ? spineMarginMm : spineMarginMm * scaleOf(vs.right.template_id)}
                    />
                  ) : (
                    <ForzacOrEmptySlot
                      width={halfWidth}
                      height={TARGET_HEIGHT_PX}
                      side="right"
                      // РЭ.43.B.2: правый форзац — для soft binding на ПОСЛЕДНЕМ
                      // визуальном развороте, если левая страница это soft_final.
                      isForzac={
                        sheetType === 'soft' &&
                        idx === visualSpreads.length - 1 &&
                        (vs.left as unknown as { section_type?: string } | null)
                          ?.section_type === 'soft_final'
                      }
                    />
                  )}
                </div>
                <div className="text-[10px] text-center text-muted-foreground mt-1">
                  {idx + 1}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── ForzacOrEmptySlot ─────────────────────────────────────────────────────
//
// РЭ.43.B.2: рендер пустой страницы в превью. Для soft binding на
// определённых позициях (первая страница слева, последняя справа когда
// left=soft_final) рисует стилизованный «Форзац» с подписью — чтобы партнёр
// сразу видел физику обложки мягкого переплёта в превью. В остальных
// случаях — просто пустая серая область (legacy поведение).
//
// Стиль форзаца повторяет тот что показан в Layout редакторе (см.
// EditorSpreadCanvas) — серая надпись «Форзац» по центру.
function ForzacOrEmptySlot({
  width,
  height,
  side,
  isForzac,
}: {
  width: number
  height: number
  side: 'left' | 'right'
  isForzac: boolean
}) {
  if (!isForzac) {
    return (
      <div
        style={{ width, height }}
        className={`bg-muted ${side === 'left' ? 'border-r border-border' : ''}`}
      />
    )
  }
  return (
    <div
      style={{ width, height }}
      className={`bg-muted ${side === 'left' ? 'border-r border-border' : ''} flex items-center justify-center`}
    >
      <span className="text-[10px] text-muted-foreground italic select-none">
        Форзац
      </span>
    </div>
  )
}
