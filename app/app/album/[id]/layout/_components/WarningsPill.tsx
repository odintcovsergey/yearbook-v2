/**
 * WarningsPill — индикатор предупреждений автосборки в редакторе альбома.
 *
 * Зачем (РЭ.36.UI):
 *   Engine при сборке альбома генерирует warnings (common_required_page_skipped,
 *   master_not_found, students_overflow и т.п.). До этого они хранились в БД
 *   album_layouts.warnings и возвращались API, но в UI редактора не отображались.
 *   Партнёр не понимал почему страница пропущена или дизайн собрался иначе чем
 *   ожидалось. Теперь — компактная плашка под навигацией с раскрывающимся
 *   списком всех предупреждений, сгруппированных по уровню.
 *
 * Поведение:
 *   - warnings.length === 0 → не рендерится (компонент возвращает null)
 *   - свёрнутый вид: pill с цветом по максимальному уровню severity:
 *       blocking (красный) > degraded (жёлтый) > info (синий)
 *   - клик → разворачивается панель со списком, сгруппированным по уровню
 *   - повторный клик / клик вне → сворачивается
 *
 * Контракт данных (из app/api/layout/route.ts:104):
 *   EnrichedWarning = { code, detail, level, source }
 *
 * UI важно: партнёр НЕ должен бояться этой плашки. Большинство warnings —
 * info/degraded, информативные, не блокирующие. Тон: «engine хочет вам
 * рассказать что-то, но альбом собрался».
 */

'use client'

import { useState, useRef, useEffect } from 'react'

// ─── Типы ──────────────────────────────────────────────────────────────────

export type WarningLevel = 'blocking' | 'degraded' | 'info'

export type EnrichedWarning = {
  code: string
  detail: string
  level: WarningLevel
  source: 'builder' | 'smart_fill'
}

// ─── Словарь codes → человеческие заголовки ────────────────────────────────
//
// detail из engine содержит специфику (имя мастера, цифры) — он показывается
// под заголовком. Заголовок отвечает на вопрос «что произошло одним словом».
// Если код не в словаре — показываем сам код (для отладки) с пометкой.

const CODE_TITLES: Record<string, string> = {
  // common_required (РЭ.32 + РЭ.35.Ж)
  common_required_master_missing: 'Мастер общего раздела не найден в дизайне',
  common_required_no_category: 'Мастер не имеет распознаваемых placeholder\u2019ов',
  common_required_page_skipped: 'Страница общего раздела пропущена',
  common_required_empty: 'Общий раздел не настроен в шаблоне',
  common_required_spread_misaligned: 'Развороту общего раздела не хватило парной страницы',

  // common (РЭ.21.8 — manual/auto режимы)
  slot_skipped: 'Слот общего раздела пропущен',
  common_no_spread_master: 'Нет мастера для фото на разворот',
  common_autopack_underflow: 'Авто-сборка создала меньше разворотов чем запрошено',
  common_autopack_disabled: 'Авто-сборка отключена, фото не размещены',

  // builder — students/teachers
  master_not_found: 'Мастер не найден в дизайне',
  students_empty: 'Нет учеников для размещения',
  students_overflow: 'Учеников больше чем мест в сетке',
  subjects_overflow: 'Преподавателей больше чем мест',
  students_grid_no_special_master: 'Не найден специальный мастер для хвоста учеников',
  name_mismatch: 'Имя в шаблоне не совпало с данными',
  class_photo_missing: 'Не загружено классное фото',
  half_class_missing: 'Не загружено фото полкласса',
  students_odd_in_standard: 'Нечётное число учеников в Стандарт-сетке',
  no_right_teacher_master: 'Нет зеркального мастера учителей для правой страницы',
  fallback_used: 'Использован фолбэк-мастер',
  students_too_few: 'Слишком мало учеников для выбранной плотности',
  adaptive_grid_fallback: 'Адаптивная сетка — фолбэк',

  // info
  no_head_teacher: 'Нет фото классного руководителя',
  students_no_portrait: 'У ученика отсутствует портрет',
  per_child_override_ignored: 'Ручной выбор фото для ребёнка проигнорирован',

  // engine generic
  rule_engine_warning: 'Предупреждение движка автосборки',
  rule_engine_partial: 'Автосборка завершилась частично',
}

// ─── Стили по уровню ───────────────────────────────────────────────────────

const LEVEL_STYLES: Record<WarningLevel, {
  pill: string
  badge: string
  panelBorder: string
  panelHeader: string
}> = {
  blocking: {
    pill: 'border-red-200 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200 dark:hover:bg-red-500/25',
    badge: 'bg-red-200 text-red-900 dark:bg-red-500/30 dark:text-red-100',
    panelBorder: 'border-red-200 dark:border-red-500/40',
    panelHeader: 'text-red-900 dark:text-red-300',
  },
  degraded: {
    pill: 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25',
    badge: 'bg-amber-200 text-amber-900 dark:bg-amber-500/30 dark:text-amber-100',
    panelBorder: 'border-amber-200 dark:border-amber-500/40',
    panelHeader: 'text-amber-900 dark:text-amber-300',
  },
  info: {
    pill: 'border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200 dark:hover:bg-sky-500/25',
    badge: 'bg-sky-200 text-sky-900 dark:bg-sky-500/30 dark:text-sky-100',
    panelBorder: 'border-sky-200 dark:border-sky-500/40',
    panelHeader: 'text-sky-900 dark:text-sky-300',
  },
}

const LEVEL_LABELS: Record<WarningLevel, string> = {
  blocking: 'Критические',
  degraded: 'Внимание',
  info: 'К сведению',
}

// ─── Вспомогательные ───────────────────────────────────────────────────────

/** Максимальный уровень из списка — определяет цвет плашки. */
function maxLevel(warnings: EnrichedWarning[]): WarningLevel {
  if (warnings.some((w) => w.level === 'blocking')) return 'blocking'
  if (warnings.some((w) => w.level === 'degraded')) return 'degraded'
  return 'info'
}

/** Группировка по уровню для вывода в панели. */
function groupByLevel(
  warnings: EnrichedWarning[],
): Record<WarningLevel, EnrichedWarning[]> {
  return {
    blocking: warnings.filter((w) => w.level === 'blocking'),
    degraded: warnings.filter((w) => w.level === 'degraded'),
    info: warnings.filter((w) => w.level === 'info'),
  }
}

/** Заголовок предупреждения по коду; для неизвестных — сам код. */
function titleForCode(code: string): string {
  return CODE_TITLES[code] ?? code
}

// ─── Компонент ─────────────────────────────────────────────────────────────

type Props = {
  warnings: EnrichedWarning[]
}

export default function WarningsPill({ warnings }: Props) {
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Клик вне компонента → свернуть.
  useEffect(() => {
    if (!expanded) return
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [expanded])

  if (!warnings || warnings.length === 0) return null

  const level = maxLevel(warnings)
  const styles = LEVEL_STYLES[level]
  const grouped = groupByLevel(warnings)

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs cursor-pointer transition-colors ${styles.pill}`}
        aria-expanded={expanded}
        aria-haspopup="dialog"
      >
        <span>⚠</span>
        <span className="font-medium">
          {warnings.length === 1
            ? '1 предупреждение'
            : `${warnings.length} предупреждений`}
        </span>
        <span className="text-[10px] opacity-75">
          {expanded ? 'скрыть' : 'показать'}
        </span>
      </button>

      {expanded && (
        <div
          role="dialog"
          aria-label="Предупреждения автосборки"
          className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 z-20 w-[min(28rem,90vw)] rounded-lg border bg-card shadow-lg ${styles.panelBorder}`}
        >
          <div className="max-h-[60vh] overflow-y-auto p-3 space-y-3">
            {(['blocking', 'degraded', 'info'] as const).map((lvl) => {
              const items = grouped[lvl]
              if (items.length === 0) return null
              const lvlStyles = LEVEL_STYLES[lvl]
              return (
                <section key={lvl}>
                  <header className="flex items-center gap-2 mb-1.5">
                    <span
                      className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold ${lvlStyles.badge}`}
                    >
                      {items.length}
                    </span>
                    <h3
                      className={`text-xs font-semibold uppercase tracking-wide ${lvlStyles.panelHeader}`}
                    >
                      {LEVEL_LABELS[lvl]}
                    </h3>
                  </header>
                  <ul className="space-y-1.5">
                    {items.map((w, idx) => (
                      <li
                        key={`${w.code}-${idx}`}
                        className="rounded-md border border-border bg-muted px-2.5 py-1.5"
                      >
                        <div className="text-xs font-medium text-foreground">
                          {titleForCode(w.code)}
                        </div>
                        {w.detail && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                            {w.detail}
                          </div>
                        )}
                        <div className="mt-0.5 text-[10px] text-muted-foreground font-mono">
                          {w.code}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
          <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Предупреждения не блокируют сборку — это подсказки автосборщика.
            Можно докрутить вручную в редакторе.
          </div>
        </div>
      )}
    </div>
  )
}
