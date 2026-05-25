'use client'

import { useEffect, useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { SpreadInstance, SpreadTemplate } from '@/lib/album-builder/types'
import { api } from '@/lib/api-client'

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
}

type Props = {
  layout: LayoutShape
  onOpenEditor: () => void
}

type TemplateDetailResponse = {
  template_set: { id: string; spread_width_mm: number; spread_height_mm: number }
  spread_templates: SpreadTemplate[]
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
 *   4. S-Intro (soft, см. master-cleanup-tz §C / designer-questions блок 1):
 *      одностраничный, рендерится как правая страница разворота с пустой левой.
 *      Детектится по template.name === 'S-Intro'.
 *
 * Вход: spreads (от buildAlbum), templateById (для проверки is_spread и name).
 * Выход: массив VisualSpread в том же порядке.
 */
function groupIntoVisualSpreads(
  spreads: SpreadInstance[],
  templateById: Map<string, SpreadTemplate>,
): VisualSpread[] {
  const result: VisualSpread[] = []
  let pending: SpreadInstance | null = null

  for (const s of spreads) {
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

    // Одностраничный мастер. Спецслучай: S-Intro = правая страница,
    // левая пустая. Не парим с предыдущим (если был pending — флашим).
    if (tmpl.name === 'S-Intro') {
      if (pending) {
        result.push({ kind: 'pair', left: pending, right: null, key: pending.spread_index })
        pending = null
      }
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

  // Финал: оставшийся непарный одностраничный — одиночка справа? слева? Лево.
  // Это случай common_right_page_empty (А.2.2.b): фотограф загрузил нечётное
  // число фото общего раздела, последняя группа без пары. Logically — левая
  // страница занята, правая пустая.
  if (pending) {
    result.push({ kind: 'pair', left: pending, right: null, key: pending.spread_index })
  }

  return result
}

export default function LayoutPreviewStrip({ layout, onOpenEditor }: Props) {
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

  // Визуальные развороты — пересчитываются когда обновляются spreads или шаблоны.
  const visualSpreads = useMemo(
    () => (detail ? groupIntoVisualSpreads(spreads, templateById) : []),
    [spreads, templateById, detail],
  )

  return (
    <div className="bg-gray-50 rounded-lg p-3 mb-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="text-xs text-gray-500 uppercase">
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

      {loading && (
        <div className="text-xs text-gray-400 py-4">Загружаем шаблон…</div>
      )}

      {error && (
        <div className="text-xs text-red-600 py-4">{error}</div>
      )}

      {!loading && !error && detail && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {visualSpreads.map((vs, idx) => {
            // Рендер двухстраничного мастера — одна клетка с одним canvas
            if (vs.kind === 'full_spread') {
              const tmpl = templateById.get(vs.instance.template_id)
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
                  <div className="bg-white rounded shadow-sm border border-gray-200">
                    <AlbumSpreadCanvas
                      instance={vs.instance}
                      template={tmpl}
                      containerWidth={containerWidth}
                      mode="preview"
                    />
                  </div>
                  <div className="text-[10px] text-center text-gray-500 mt-1">
                    {idx + 1}
                  </div>
                </div>
              )
            }

            // Рендер пары одностраничных мастеров (или одиночки с пустой стороной)
            const leftTmpl = vs.left ? templateById.get(vs.left.template_id) : null
            const rightTmpl = vs.right ? templateById.get(vs.right.template_id) : null

            // Ширина каждой половины — на основании первого доступного шаблона
            const refTmpl = leftTmpl ?? rightTmpl
            const halfWidth = refTmpl
              ? (refTmpl.width_mm / refTmpl.height_mm) * TARGET_HEIGHT_PX
              : TARGET_HEIGHT_PX * 0.7  // fallback на случай если оба null (не должно случаться)

            return (
              <div key={vs.key} className="flex-shrink-0">
                <div className="bg-white rounded shadow-sm border border-gray-200 flex">
                  {/* Левая страница */}
                  {vs.left && leftTmpl ? (
                    <AlbumSpreadCanvas
                      instance={vs.left}
                      template={leftTmpl}
                      containerWidth={halfWidth}
                      mode="preview"
                    />
                  ) : (
                    <div
                      style={{ width: halfWidth, height: TARGET_HEIGHT_PX }}
                      className="bg-gray-50 border-r border-gray-100"
                    />
                  )}
                  {/* Правая страница */}
                  {vs.right && rightTmpl ? (
                    <AlbumSpreadCanvas
                      instance={vs.right}
                      template={rightTmpl}
                      containerWidth={halfWidth}
                      mode="preview"
                    />
                  ) : (
                    <div
                      style={{ width: halfWidth, height: TARGET_HEIGHT_PX }}
                      className="bg-gray-50"
                    />
                  )}
                </div>
                <div className="text-[10px] text-center text-gray-500 mt-1">
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
