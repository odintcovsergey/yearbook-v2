'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { X } from 'lucide-react'
import type { SpreadTemplate } from '@/lib/album-builder/types'
import { humanMasterLabel } from '@/lib/album-builder/master-label'

const AlbumSpreadCanvas = dynamic(
  () => import('@/app/app/_components/AlbumSpreadCanvas'),
  { ssr: false, loading: () => null },
)

// ─── JMasterPicker ────────────────────────────────────────────────────────
//
// РЭ.32.Б.1 — модалка выбора мастера общего раздела при создании страницы
// в конструкторе шаблона (CommonRequiredPagesEditor).
//
// Чем отличается от TemplatePickerModal (который для редактора заказа):
//   - Показывает ТОЛЬКО мастера общего раздела (J-мастера в OkeyBook-договоре).
//     Фильтр гибридный (решение Q1 в spec'е РЭ.32):
//       - page_role === 'common'  ИЛИ
//       - placeholders содержит classphotoframe / halfphoto_* / quarterphoto_*
//         / sixthphoto_* / collagephoto_* / spreadphoto (анализ как страховка)
//   - Скрывает -Right варианты зеркальных мастеров (решение Q7). При сборке
//     engine сам подставит -Right если страница на правой позиции.
//   - Группирует по «вместимости» (что внутри): 1 общая / 2 половины / 4
//     четверти / 6 коллаж / разворот / другое. Это интуитивно для партнёра.
//
// Превью каждого мастера рисуется через AlbumSpreadCanvas с пустым
// instance (data={}).

type Capacity = 'full' | 'half' | 'quarter' | 'sixth' | 'collage' | 'spread' | 'other'

type Props = {
  templates: SpreadTemplate[]
  onSelect: (template: SpreadTemplate) => void
  onClose: () => void
}

const PREVIEW_WIDTH = 200

const CAPACITY_LABELS: Record<Capacity, string> = {
  full: '1 общая фотография',
  half: '2 фото по 1/2',
  // Постраничная модель: на странице 2 quarter-фото. На развороте
  // выходит 4 (левая + правая страницы по 2). Раньше было неверно
  // 'четверти 4' — путало партнёра, который думал что 4 фото на ОДНОЙ
  // странице.
  quarter: '2 фото по 1/4',
  collage: 'Коллаж',
  sixth: '6 фото по 1/6 класса',
  spread: 'На разворот',
  other: 'Прочее',
}

const CAPACITY_ORDER: Capacity[] = ['full', 'half', 'quarter', 'sixth', 'collage', 'spread', 'other']

/**
 * Анализирует placeholders мастера и определяет его «вместимость» —
 * что он умеет принять (для группировки в пикере).
 */
function classifyMaster(master: SpreadTemplate): Capacity {
  let hasFull = false
  let halfCount = 0
  let quarterCount = 0
  let sixthCount = 0
  let collageCount = 0
  let hasSpread = false

  for (const ph of master.placeholders ?? []) {
    const label = ph.label.toLowerCase()
    if (label === 'classphotoframe') hasFull = true
    else if (label.match(/^halfphoto_\d+$/)) halfCount++
    else if (label.match(/^quarterphoto_\d+$/)) quarterCount++
    else if (label.match(/^sixthphoto_\d+$/)) sixthCount++
    else if (label.match(/^collagephoto_\d+$/)) collageCount++
    else if (label === 'spreadphoto') hasSpread = true
  }

  if (hasSpread) return 'spread'
  if (sixthCount > 0) return 'sixth'
  if (collageCount > 0) return 'collage'
  // J-Quarter-Left / J-Quarter-Right в постраничной модели содержат
  // ПО 2 quarterphoto_N на странице (всего 4 на разворот). Поэтому
  // >= 2, а не >= 4. Раньше Quarter-мастера попадали в 'other' и
  // не показывались партнёру в пикере (баг РЭ.57).
  if (quarterCount >= 2) return 'quarter'
  if (halfCount >= 2) return 'half'
  if (hasFull) return 'full'
  return 'other'
}

/**
 * Роли мастеров которые точно НЕ относятся к общему разделу.
 * Жёсткий blacklist для page_role: даже если у мастера внутри есть
 * classphotoframe (как в учительских F-Head-WithClassPhoto или в
 * combined-tail M/L/N-Combined-Page), он не должен попадать в пикер
 * общего раздела.
 */
const NON_COMMON_PAGE_ROLES = new Set<string>([
  'student',
  'student_grid',
  'student_grid_left',
  'student_grid_right',
  'student_left',
  'student_right',
  'student_overflow',
  'student_last',
  'teacher_left',
  'teacher_right',
  'intro',
  'cover',
])

/**
 * Определяет является ли мастер «общим» (подходит для общего раздела).
 * Решение Q1 spec'а РЭ.32 — гибридный фильтр с приоритетом negative-match.
 *
 * Логика (РЭ.32.Б.5 — fix после фидбэка Сергея 22.05):
 *   1. page_role в blacklist → отсекаем сразу.
 *   2. Есть studentportrait_N / studentname_N / teacherphoto_N /
 *      teachername_N / headteacher* → отсекаем (не J-мастер).
 *   3. page_role='common' → считаем общим.
 *   4. Иначе — определяем по placeholders (classifyMaster).
 */
function isCommonMaster(master: SpreadTemplate): boolean {
  if (master.page_role && NON_COMMON_PAGE_ROLES.has(master.page_role)) {
    return false
  }
  for (const ph of master.placeholders ?? []) {
    const l = ph.label.toLowerCase()
    if (
      l.startsWith('studentportrait_') ||
      l.startsWith('studentname_') ||
      l.startsWith('teacherphoto_') ||
      l.startsWith('teachername_') ||
      l === 'headteacherphoto' ||
      l === 'headteachername'
    ) {
      return false
    }
  }
  if (master.page_role === 'common') return true
  const cap = classifyMaster(master)
  return cap !== 'other'
}

/**
 * Является ли мастер «правым» зеркальным вариантом. Скрываем такие
 * из пикера — engine сам подставит при позиции right.
 */
function isMirrorRight(master: SpreadTemplate): boolean {
  return master.name.endsWith('-Right')
}

export default function JMasterPicker({ templates, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Фильтрация: только общие мастера, без -Right вариантов, по поиску.
    const filtered = templates.filter((t) => {
      if (!isCommonMaster(t)) return false
      if (isMirrorRight(t)) return false
      if (q) {
        const haystack = `${t.name} ${t.audit_notes ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    // Группировка по «вместимости».
    const byCapacity = new Map<Capacity, SpreadTemplate[]>()
    for (const t of filtered) {
      const cap = classifyMaster(t)
      if (!byCapacity.has(cap)) byCapacity.set(cap, [])
      byCapacity.get(cap)!.push(t)
    }

    // Сортировка внутри группы — по имени.
    for (const list of Array.from(byCapacity.values())) {
      list.sort((a, b) => a.name.localeCompare(b.name))
    }

    // Возврат в фиксированном порядке CAPACITY_ORDER.
    const result: { capacity: Capacity; label: string; list: SpreadTemplate[] }[] = []
    for (const cap of CAPACITY_ORDER) {
      const list = byCapacity.get(cap)
      if (list && list.length > 0) {
        result.push({ capacity: cap, label: CAPACITY_LABELS[cap], list })
      }
    }
    return result
  }, [templates, query])

  function emptyInstance(template: SpreadTemplate) {
    return {
      spread_index: 0,
      template_id: template.id,
      template_name: template.name,
      data: {} as Record<string, string | null>,
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-foreground">
              Выбор мастера для общего раздела
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Зеркальные «правые» варианты (например J-Quarter-Right) скрыты —
              engine подставит их автоматически если страница окажется на
              правой стороне разворота.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none"
            title="Закрыть (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-border">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию мастера…"
            className="w-full px-3 py-2 text-sm border border-border rounded focus:outline-none focus:border-blue-400"
            autoFocus
          />
        </div>

        {/* Masters grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {query
                ? `Не найдено мастеров по запросу «${query}»`
                : 'В этом дизайне нет мастеров общего раздела. Обратитесь к дизайнеру.'}
            </p>
          ) : (
            groups.map(({ capacity, label, list }) => (
              <div key={capacity} className="mb-6 last:mb-0">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  {label}{' '}
                  <span className="text-muted-foreground ml-1">({list.length})</span>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {list.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        onSelect(t)
                        onClose()
                      }}
                      className="text-left border border-border rounded-lg overflow-hidden hover:border-blue-400 hover:shadow-md transition-all bg-card"
                      title={t.audit_notes ?? t.name}
                    >
                      <div className="bg-muted">
                        <AlbumSpreadCanvas
                          instance={emptyInstance(t)}
                          template={t}
                          containerWidth={PREVIEW_WIDTH}
                          mode="preview"
                        />
                      </div>
                      <div className="px-2 py-1.5">
                        <p className="text-xs font-medium text-foreground truncate">
                          {humanMasterLabel(t)}
                        </p>
                        {humanMasterLabel(t) !== t.name && (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {t.name}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
