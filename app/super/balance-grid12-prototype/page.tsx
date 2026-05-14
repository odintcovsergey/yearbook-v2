'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { balanceRegularGrid } from '@/lib/album-builder/balance'
import type { SpreadTemplate, SpreadInstance } from '@/lib/album-builder/types'

const AlbumSpreadCanvas = dynamic(
  () => import('@/app/app/_components/AlbumSpreadCanvas'),
  { ssr: false, loading: () => <div className="text-gray-400">Загружаем canvas…</div> },
)

// ─── Прототип L-Grid-12 с overflow на второй разворот ─────────────────────
//
// Тестовый мастер: 2 ряда × 6 колонок = 12 ячеек на разворот.
// Применяется в комплектациях Light/Mini.
//
// Слайдер 1..18 имитирует разное число учеников:
//   - 1..12 → один разворот L-Grid-12 (с balanceRegularGrid)
//   - 13..18 → два разворота: первый полный (12), второй с балансировкой остатка
//
// Способ B нумерации (сквозная по строкам через обе страницы разворота):
//   Верхний ряд: 1, 2, 3 (лев) + 4, 5, 6 (прав)
//   Нижний ряд: 7, 8, 9 (лев) + 10, 11, 12 (прав)
//
// Это даёт визуально приятную балансировку: последние скрытые слоты
// концентрируются в правом нижнем углу разворота.

const TEST_TEMPLATE_SET_SLUG = 'test-balance-grid12'
const MASTER_CAPACITY = 12
const MIN_STUDENTS = 1
const MAX_STUDENTS = 18

async function api(url: string) {
  return fetch(url, { credentials: 'include' })
}

// Демо-ФИО для индексации
const STUDENT_NAMES = [
  'Иванов А.', 'Петрова К.', 'Сидоров М.', 'Волкова Е.', 'Кузнецов И.', 'Соколова О.',
  'Морозов С.', 'Лебедева А.', 'Орлов Д.', 'Беляева П.', 'Зайцев Н.', 'Гончарова Я.',
  'Фёдоров Т.', 'Михайлова Р.', 'Андреев Б.', 'Виноградова У.', 'Ершов Ф.', 'Жукова З.',
]

// HSL(hue, 60%, 55%) → hex для placehold.co
function encodeHsl(hue: number): string {
  const s = 0.6
  const l = 0.55
  const h = hue / 360
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `${f(0)}${f(8)}${f(4)}`
}

// Заполнение data для одного разворота.
// studentOffset — с какого глобального номера ученика начинать (0 или 12).
// count — сколько ячеек заполнить в этом мастере (1..12).
function buildSpreadData(
  studentOffset: number,
  count: number,
): Record<string, string | null> {
  const data: Record<string, string | null> = {}
  for (let i = 1; i <= MASTER_CAPACITY; i++) {
    if (i <= count) {
      const studentIdx = studentOffset + i - 1
      const hex = encodeHsl((studentIdx * 137) % 360)
      data[`studentportrait_${i}`] = `https://placehold.co/220x300/${hex}/white?text=${studentOffset + i}`
      data[`studentname_${i}`] = STUDENT_NAMES[studentIdx] ?? `Ученик ${studentOffset + i}`
    } else {
      data[`studentportrait_${i}`] = null
      data[`studentname_${i}`] = null
    }
  }
  return data
}

export default function BalanceGrid12PrototypePage() {
  const [template, setTemplate] = useState<SpreadTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState(10)

  useEffect(() => {
    async function load() {
      try {
        const listRes = await api('/api/layout?action=template_sets')
        if (!listRes.ok) throw new Error(`template_sets HTTP ${listRes.status}`)
        const listData = await listRes.json()
        const sets: any[] = Array.isArray(listData) ? listData : (listData.template_sets ?? [])
        const testSet = sets.find((s: any) => s.slug === TEST_TEMPLATE_SET_SLUG)
        if (!testSet) {
          throw new Error(
            `Тестовый template_set '${TEST_TEMPLATE_SET_SLUG}' не найден. Примените test-balance-grid12.sql в Supabase SQL Editor.`,
          )
        }
        const detailRes = await api(`/api/layout?action=template_set_detail&id=${testSet.id}`)
        if (!detailRes.ok) throw new Error(`detail HTTP ${detailRes.status}`)
        const detail = await detailRes.json()
        const tpl = (detail.spread_templates ?? [])[0] as SpreadTemplate
        if (!tpl) throw new Error('В template_set нет мастеров')
        setTemplate(tpl)
      } catch (e: any) {
        setError(e?.message ?? 'network error')
      }
    }
    load()
  }, [])

  if (error) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold mb-2">Прототип L-Grid-12</h1>
        <div className="card p-4 bg-red-50 border-red-200">
          <p className="text-red-700 text-sm">{error}</p>
          <p className="text-xs text-gray-600 mt-2">
            Если ошибка про &laquo;не найден&raquo; — примените SQL{' '}
            <code className="bg-white px-1 py-0.5 rounded border">test-balance-grid12.sql</code>{' '}
            в Supabase SQL Editor.
          </p>
        </div>
      </div>
    )
  }

  if (!template) {
    return <div className="p-8 text-gray-500">Загружаем тестовый мастер…</div>
  }

  // Каскад разворотов: если учеников больше capacity, делим на 2 разворота
  const spreads: { studentOffset: number; cellCount: number }[] = []
  if (count <= MASTER_CAPACITY) {
    spreads.push({ studentOffset: 0, cellCount: count })
  } else {
    spreads.push({ studentOffset: 0, cellCount: MASTER_CAPACITY })
    spreads.push({ studentOffset: MASTER_CAPACITY, cellCount: count - MASTER_CAPACITY })
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">
        Прототип балансировки L-Grid-12 (Light/Mini)
      </h1>
      <p className="text-sm text-gray-600 mb-6">
        Двухстраничный мастер 2 ряда × 6 колонок = 12 учеников. Сквозная нумерация
        по строкам разворота (способ B). При нехватке учеников алгоритм скрывает
        последние ячейки (правый нижний угол), при избытке — раскладывает остаток
        на второй разворот.
      </p>

      <div className="card p-4 mb-6">
        <label className="block">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm font-medium">
              Учеников в классе:{' '}
              <span className="text-blue-600 text-lg font-bold">{count}</span>
              <span className="text-gray-500 ml-2">
                ({spreads.length} {spreads.length === 1 ? 'разворот' : 'разворота'})
              </span>
            </span>
            <span className="text-xs text-gray-500">
              {spreads.map((s, i) => (
                <span key={i} className="ml-2">
                  Разворот {i + 1}: {s.cellCount}/12
                </span>
              ))}
            </span>
          </div>
          <input
            type="range"
            min={MIN_STUDENTS}
            max={MAX_STUDENTS}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
            {Array.from({ length: MAX_STUDENTS - MIN_STUDENTS + 1 }, (_, i) => (
              <span key={i}>{i + MIN_STUDENTS}</span>
            ))}
          </div>
        </label>
      </div>

      {/* Развороты */}
      <div className="space-y-6">
        {spreads.map((spreadData, idx) => {
          const data = buildSpreadData(spreadData.studentOffset, spreadData.cellCount)
          const instance: SpreadInstance = {
            spread_index: idx,
            template_id: template.id,
            template_name: template.name,
            data,
          }
          const balanceResult = balanceRegularGrid(
            template.placeholders,
            'studentportrait',
            spreadData.cellCount,
          )

          return (
            <div key={idx}>
              <div className="flex items-baseline gap-3 mb-2">
                <h2 className="text-sm font-semibold text-gray-700">
                  Разворот {idx + 1}: {spreadData.cellCount} ученик
                  {spreadData.cellCount === 1 ? '' : spreadData.cellCount < 5 ? 'а' : 'ов'}
                </h2>
                <span className="text-xs text-gray-500">
                  {balanceResult.strategy}
                  {balanceResult.detectedGrid &&
                    ` · сетка ${balanceResult.detectedGrid.rows}×${balanceResult.detectedGrid.cols}`}
                </span>
              </div>
              <div className="card p-2 bg-white">
                <AlbumSpreadCanvas
                  instance={instance}
                  template={template}
                  containerWidth={1000}
                  mode="preview"
                  placeholderOverrides={balanceResult.overrides}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
