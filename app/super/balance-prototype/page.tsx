'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { balanceRegularGrid } from '@/lib/album-builder/balance'
import type { SpreadTemplate, SpreadInstance } from '@/lib/album-builder/types'

const AlbumSpreadCanvas = dynamic(
  () => import('@/app/app/_components/AlbumSpreadCanvas'),
  { ssr: false, loading: () => <div className="text-gray-400">Загружаем canvas…</div> },
)

// ─── Прототип балансировки для regular grid ────────────────────────────────
//
// Эта страница демонстрирует алгоритм balanceRegularGrid на тестовом
// мастере T-TEST-Grid-9 (создан через test-balance-template.sql).
//
// Слайдер позволяет менять used_count (число фактически заполненных
// предметников от 0 до 9) и сразу видеть результат балансировки.
//
// Цель: дать Сергею визуальную оценку «нормально ли выглядит сетка 7-в-9»
// прежде чем заказывать у дизайнера много мастеров на все случаи.

const TEST_TEMPLATE_SET_SLUG = 'test-balance-grid'

type FetchedTemplate = {
  id: string
  name: string
  type: string
  is_spread: boolean
  width_mm: number
  height_mm: number
  placeholders: any[]
  rules: any
  sort_order: number
  applies_to_configs: string[]
  default_for_configs: string[]
  page_role: string | null
  slot_capacity: any
  is_fallback: boolean
  mirror_for_soft: boolean
  audit_notes: string | null
}

type FetchedData = {
  template_set: {
    id: string
    name: string
    slug: string
    page_width_mm: number
    page_height_mm: number
  }
  spread_templates: FetchedTemplate[]
}

async function api(url: string) {
  const res = await fetch(url, { credentials: 'include' })
  return res
}

export default function BalancePrototypePage() {
  const [data, setData] = useState<FetchedData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [usedCount, setUsedCount] = useState(7)

  useEffect(() => {
    async function load() {
      try {
        // Сначала найти template_set по slug
        const listRes = await api('/api/layout?action=template_sets')
        if (!listRes.ok) {
          throw new Error(`template_sets HTTP ${listRes.status}`)
        }
        const listData = await listRes.json()
        // Endpoint возвращает массив напрямую (не объект с полем template_sets)
        const sets: any[] = Array.isArray(listData) ? listData : (listData.template_sets ?? [])
        const testSet = sets.find((s: any) => s.slug === TEST_TEMPLATE_SET_SLUG)
        if (!testSet) {
          throw new Error(
            `Тестовый template_set '${TEST_TEMPLATE_SET_SLUG}' не найден. Примените test-balance-template.sql в Supabase.`,
          )
        }
        const detailRes = await api(
          `/api/layout?action=template_set_detail&id=${testSet.id}`,
        )
        if (!detailRes.ok) {
          throw new Error(`detail HTTP ${detailRes.status}`)
        }
        const detail = await detailRes.json()
        setData(detail)
      } catch (e: any) {
        setError(e?.message ?? 'network error')
      }
    }
    load()
  }, [])

  if (error) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold mb-2">Прототип балансировки</h1>
        <div className="card p-4 bg-red-50 border-red-200">
          <p className="text-red-700 text-sm">{error}</p>
          <p className="text-xs text-gray-600 mt-2">
            Если ошибка про &laquo;не найден&raquo; — сначала примените SQL{' '}
            <code className="bg-white px-1 py-0.5 rounded border">test-balance-template.sql</code>{' '}
            в Supabase SQL Editor.
          </p>
        </div>
      </div>
    )
  }

  if (!data) {
    return <div className="p-8 text-gray-500">Загружаем тестовый мастер…</div>
  }

  const template = data.spread_templates[0] as unknown as SpreadTemplate
  if (!template) {
    return (
      <div className="p-8 text-gray-500">
        В тестовом template_set нет мастеров. Примените SQL.
      </div>
    )
  }

  // Создаём фейковый SpreadInstance с заполненными данными для usedCount
  // ячеек. Photo URL'ы — заглушки (потом покажем стандартный grey)
  const fakeData: Record<string, string | null> = {}

  // Классрук (всегда заполнен)
  fakeData['teacherphoto_head'] = 'https://placehold.co/400x500/4a90e2/white?text=Классрук'
  fakeData['teachername_head'] = 'Иванова Анна Петровна'

  // Групповое (всегда)
  fakeData['groupphoto_1'] = 'https://placehold.co/680x360/95c11f/white?text=Класс'

  // Предметники: первые usedCount заполнены
  const subjects = [
    'математика', 'русский язык', 'литература', 'физика', 'химия',
    'биология', 'история', 'география', 'информатика',
  ]
  const surnames = [
    'Петров А.А.', 'Сидорова М.К.', 'Кузнецов И.В.', 'Волкова Е.Н.',
    'Морозов С.П.', 'Лебедева О.И.', 'Соколов Д.А.', 'Орлова К.С.', 'Беляев П.М.',
  ]

  for (let i = 1; i <= 9; i++) {
    if (i <= usedCount) {
      fakeData[`teacherphoto_${i}`] = `https://placehold.co/220x220/8e44ad/white?text=${i}`
      fakeData[`teachername_${i}`] = surnames[i - 1] ?? `Учитель ${i}`
      fakeData[`teachersubject_${i}`] = subjects[i - 1] ?? 'предмет'
    } else {
      fakeData[`teacherphoto_${i}`] = null
      fakeData[`teachername_${i}`] = null
      fakeData[`teachersubject_${i}`] = null
    }
  }

  const instance: SpreadInstance = {
    spread_index: 0,
    template_id: template.id,
    template_name: template.name,
    data: fakeData,
  }

  // Запускаем алгоритм балансировки
  const balanceResult = balanceRegularGrid(
    template.placeholders,
    'teacherphoto',
    usedCount,
  )

  return (
    <div className="p-6 max-w-7xl">
      <h1 className="text-2xl font-semibold mb-2">
        Прототип балансировки regular grid
      </h1>
      <p className="text-sm text-gray-600 mb-6">
        Тестовый мастер 3×3 предметники (см. <code className="bg-gray-100 px-1 rounded">test-balance-template.sql</code>).
        Слайдер меняет число фактически заполненных предметников. Алгоритм скрывает
        лишние и центрирует оставшиеся.
      </p>

      <div className="card p-4 mb-6">
        <label className="block">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm font-medium">
              Заполнено предметников: <span className="text-blue-600 text-lg font-bold">{usedCount}</span> / 9
            </span>
            <span className="text-xs text-gray-500">
              Стратегия: {balanceResult.strategy}
              {balanceResult.detectedGrid &&
                ` · сетка ${balanceResult.detectedGrid.rows}×${balanceResult.detectedGrid.cols}`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={9}
            value={usedCount}
            onChange={(e) => setUsedCount(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0</span>
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span>5</span>
            <span>6</span>
            <span>7</span>
            <span>8</span>
            <span>9</span>
          </div>
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Сравнение: без балансировки (просто скрытые слоты) */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            БЕЗ балансировки (просто скрыть лишние)
          </h2>
          <div className="card p-2 bg-white">
            <AlbumSpreadCanvas
              instance={instance}
              template={template}
              containerWidth={500}
              mode="preview"
              placeholderOverrides={(() => {
                // Только скрываем без центрирования
                const ov: Record<string, { hidden?: boolean }> = {}
                for (let i = usedCount + 1; i <= 9; i++) {
                  ov[`teacherphoto_${i}`] = { hidden: true }
                  ov[`teachername_${i}`] = { hidden: true }
                  ov[`teachersubject_${i}`] = { hidden: true }
                }
                return ov
              })()}
            />
          </div>
        </div>

        {/* С балансировкой */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            С балансировкой (центрирование оставшихся)
          </h2>
          <div className="card p-2 bg-white">
            <AlbumSpreadCanvas
              instance={instance}
              template={template}
              containerWidth={500}
              mode="preview"
              placeholderOverrides={balanceResult.overrides}
            />
          </div>
        </div>
      </div>

      <details className="mt-6">
        <summary className="text-xs text-gray-500 cursor-pointer">
          Debug: overrides JSON
        </summary>
        <pre className="text-xs bg-gray-50 p-3 rounded mt-2 overflow-x-auto">
          {JSON.stringify(balanceResult, null, 2)}
        </pre>
      </details>
    </div>
  )
}
