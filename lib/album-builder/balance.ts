/**
 * Алгоритм балансировки regular grid placeholder'ов.
 *
 * Контекст: дизайнер делает мастер с фиксированным числом слотов (например
 * сетка 3×3 = 9 предметников). В реальном классе предметников может быть
 * меньше (например 7). Алгоритм скрывает «лишние» слоты и переразмещает
 * оставшиеся симметрично, чтобы избежать «дырявых» сеток.
 *
 * Стратегия:
 *   1. Группируем placeholder'ы по «логическим ячейкам» (фото + связанные
 *      с ним подписи) — определяется по trailing-индексу в label
 *      (teacherphoto_1, teachername_1, teachersubject_1 = одна ячейка).
 *   2. Определяем regular grid: разбиваем ячейки на ряды по координате Y,
 *      затем по X внутри ряда. Получаем матрицу cells[row][col].
 *   3. Для used_count ячеек ищем оптимальное расположение в сетке:
 *      - Если used_count = total → ничего не меняем
 *      - Если used_count = total - 1 → скрываем последнюю ячейку, остальные
 *        не двигаем (визуально просто пустое место в углу)
 *      - Если used_count меньше — выбираем «симметричную» подсетку
 *        (например для 7 в 3×3: верхние 2 ряда полные + 1 центрированно)
 *   4. Для не-grid placeholder'ов (классрук, групповое — у них нет trailing
 *      индекса или индекс _head) — НЕ трогаем.
 *
 * Возвращает: Map<label, override> где override = { hidden: true } или
 * { x_mm, y_mm } (новые координаты). Placeholder'ы не упомянутые в Map —
 * остаются с исходными координатами.
 */

import type { Placeholder } from './types'

export type PlaceholderOverride = {
  hidden?: boolean
  x_mm?: number
  y_mm?: number
}

export type BalanceResult = {
  overrides: Record<string, PlaceholderOverride>
  // Метаданные для отладки/UI
  detectedGrid: { rows: number; cols: number; totalCells: number } | null
  strategy: string
}

/**
 * Главная функция балансировки.
 *
 * @param placeholders все placeholder'ы мастера
 * @param indexedGroup base name для нумерованной группы (например 'teacherphoto')
 *                    Алгоритм найдёт все placeholder'ы с label `<base>_N`
 *                    и применит балансировку к ним и связанным name/subject.
 * @param usedCount сколько фактически данных есть (1..total)
 */
export function balanceRegularGrid(
  placeholders: Placeholder[],
  indexedGroup: string,
  usedCount: number,
): BalanceResult {
  const overrides: Record<string, PlaceholderOverride> = {}

  // Шаг 1: найти все «ячейки» — группы placeholder'ов с одинаковым
  // trailing-индексом N в label, при условии что один из них — основное
  // photo с base = indexedGroup.
  const cellsByIndex = new Map<number, Placeholder[]>()
  const otherPlaceholders: Placeholder[] = []

  for (const ph of placeholders) {
    const match = ph.label.match(/^(.+)_(\d+)$/)
    if (!match) {
      otherPlaceholders.push(ph)
      continue
    }
    const baseLabel = match[1]
    const idx = parseInt(match[2], 10)
    // Учитываем как «принадлежит ячейке N» любой placeholder с trailing _N,
    // независимо от base — это позволит включить teachername_1, teachersubject_1
    // в ту же ячейку что teacherphoto_1. Фильтр по indexedGroup идёт
    // на уровне основного photo (определяет какие ячейки вообще существуют).
    if (!cellsByIndex.has(idx)) cellsByIndex.set(idx, [])
    cellsByIndex.get(idx)!.push(ph)
    void baseLabel  // для будущего расширения если потребуется
  }

  // Берём только те индексы где есть photo с label indexedGroup_N
  // (другие индексы — это другие группы, например studentphoto_N
  //  в общем мастере если их несколько типов).
  const validIndices = Array.from(cellsByIndex.keys()).filter((idx) => {
    const cell = cellsByIndex.get(idx)!
    return cell.some(
      (ph) => ph.type === 'photo' && ph.label === `${indexedGroup}_${idx}`,
    )
  }).sort((a, b) => a - b)

  if (validIndices.length === 0) {
    return {
      overrides: {},
      detectedGrid: null,
      strategy: `no cells found for ${indexedGroup}`,
    }
  }

  // Шаг 2: определить regular grid по photo-placeholder'ам.
  // Сортируем photo по (y, x) и определяем уникальные строки/колонки.
  const photoByIndex = new Map<number, Placeholder>()
  for (const idx of validIndices) {
    const cell = cellsByIndex.get(idx)!
    const photo = cell.find(
      (ph) => ph.type === 'photo' && ph.label === `${indexedGroup}_${idx}`,
    )
    if (photo) photoByIndex.set(idx, photo)
  }

  // Группировка по y (ряды): photo с близкими y в одном ряду.
  // Близкость = разница <= 5мм (произвольный порог для устранения
  // floating-point ошибок и микро-отступов).
  const sortedPhotos = Array.from(photoByIndex.values()).sort(
    (a, b) => a.y_mm - b.y_mm || a.x_mm - b.x_mm,
  )
  const rowsY: number[] = []
  for (const ph of sortedPhotos) {
    if (rowsY.length === 0 || Math.abs(ph.y_mm - rowsY[rowsY.length - 1]) > 5) {
      rowsY.push(ph.y_mm)
    }
  }

  // Определяем матрицу cells[row][col] из индексов
  const matrix: number[][] = rowsY.map(() => [])
  for (const idx of validIndices) {
    const photo = photoByIndex.get(idx)!
    const rowIdx = rowsY.findIndex((y) => Math.abs(photo.y_mm - y) <= 5)
    if (rowIdx === -1) continue
    matrix[rowIdx].push(idx)
  }
  // Внутри ряда сортируем по x
  for (const row of matrix) {
    row.sort((a, b) => {
      const aX = photoByIndex.get(a)!.x_mm
      const bX = photoByIndex.get(b)!.x_mm
      return aX - bX
    })
  }

  const totalCells = validIndices.length
  const rows = matrix.length
  const cols = Math.max(...matrix.map((r) => r.length))
  const isRegular = matrix.every((r) => r.length === cols)

  const detectedGrid = { rows, cols, totalCells }

  if (!isRegular) {
    return {
      overrides: {},
      detectedGrid,
      strategy: 'irregular grid — balancing not applied',
    }
  }

  // Шаг 3: применить стратегию для used_count.
  // Базовая стратегия:
  //   - used_count >= total: ничего не делаем
  //   - used_count < total: выбираем подмножество ячеек которые останутся
  //     видимыми, скрываем остальные. Расставляем выбранные на координатах
  //     первых used_count исходных ячеек (по порядку).
  //
  // Алгоритм выбора видимых ячеек:
  //   - Заполняем ряды снизу-вверх не оставляя «дыр» в верхних рядах
  //   - Для последнего (нижнего) неполного ряда — центрируем оставшиеся
  //
  // Например 3×3, used=7:
  //   Ряд 0 (полный): cells 1,2,3 — на местах cells 1,2,3
  //   Ряд 1 (полный): cells 4,5,6 — на местах cells 4,5,6
  //   Ряд 2 (неполный, 1 ячейка): cell 7 — на месте cell 8 (центр)
  //
  // Например 3×3, used=5:
  //   Ряд 0 (полный): cells 1,2,3
  //   Ряд 1 (неполный, 2 ячейки): cells 4,5 — на местах cells 4,5 (со сдвигом к центру)
  //   Скрыто: 6,7,8,9

  if (usedCount >= totalCells) {
    return {
      overrides: {},
      detectedGrid,
      strategy: `full fill (${usedCount}/${totalCells})`,
    }
  }

  if (usedCount <= 0) {
    // Скрыть всё
    for (const idx of validIndices) {
      const cell = cellsByIndex.get(idx)!
      for (const ph of cell) {
        overrides[ph.label] = { hidden: true }
      }
    }
    return {
      overrides,
      detectedGrid,
      strategy: `all hidden (0/${totalCells})`,
    }
  }

  // Определяем сколько рядов будут заполнены полностью
  const fullRows = Math.floor(usedCount / cols)
  const remainder = usedCount - fullRows * cols  // 0..cols-1

  // Целевые позиции: первые `fullRows` рядов полные, последний ряд (если есть)
  // центрирован. Берём координаты из исходной матрицы.
  const targetPositions: { x_mm: number; y_mm: number }[] = []
  for (let r = 0; r < fullRows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellIdx = matrix[r][c]
      const photo = photoByIndex.get(cellIdx)!
      targetPositions.push({ x_mm: photo.x_mm, y_mm: photo.y_mm })
    }
  }
  if (remainder > 0) {
    // Последний (неполный) ряд — центрируем остаток.
    //
    // ВАЖНО: «истинное центрирование» — не просто взять `remainder` ячеек
    // подряд из центра ряда (это даст несимметричный результат для чётного
    // remainder при нечётном cols). Вместо этого рассчитываем новые
    // координаты X для каждой из `remainder` ячеек так, чтобы они были
    // равноудалены от центра ряда.
    //
    // Алгоритм:
    //   - rowY: Y-координата ряда (из первой ячейки)
    //   - rowStartX: X-координата самой левой ячейки в ряду
    //   - rowEndX: X-координата самой правой ячейки в ряду + её ширина
    //   - rowCenterX: середина по X
    //   - cellWidth: ширина одной ячейки (от первой photo)
    //   - step: шаг между центрами ячеек = (rowEndX - rowStartX) / (cols - 1)
    //   - При remainder ячеек шаг между ними тот же step
    //   - Группа из `remainder` ячеек шириной (remainder-1)*step
    //   - Левая ячейка группы: rowCenterX - ((remainder-1)*step)/2 - cellWidth/2
    const rowIdx = fullRows
    if (rowIdx < matrix.length) {
      const rowCells = matrix[rowIdx]
      const firstPhoto = photoByIndex.get(rowCells[0])!
      const lastPhoto = photoByIndex.get(rowCells[rowCells.length - 1])!
      const cellWidth = firstPhoto.width_mm
      // Шаг между центрами соседних ячеек ряда
      const step = rowCells.length > 1
        ? (lastPhoto.x_mm - firstPhoto.x_mm) / (rowCells.length - 1)
        : 0
      // Центр ряда (по X центров крайних ячеек + cellWidth/2)
      const rowCenterX = (firstPhoto.x_mm + lastPhoto.x_mm) / 2 + cellWidth / 2
      const rowY = firstPhoto.y_mm

      // Левая граница группы из `remainder` ячеек
      const groupWidth = (remainder - 1) * step + cellWidth
      const groupStartX = rowCenterX - groupWidth / 2

      for (let i = 0; i < remainder; i++) {
        targetPositions.push({
          x_mm: groupStartX + i * step,
          y_mm: rowY,
        })
      }
    }
  }

  // Применяем: первые usedCount ячеек получают новые координаты (если
  // они изменились), остальные скрываются.
  for (let i = 0; i < validIndices.length; i++) {
    const idx = validIndices[i]
    const cell = cellsByIndex.get(idx)!
    if (i < usedCount) {
      // Активная ячейка — переносим на целевую позицию
      const target = targetPositions[i]
      const sourcePhoto = photoByIndex.get(idx)!
      const deltaX = target.x_mm - sourcePhoto.x_mm
      const deltaY = target.y_mm - sourcePhoto.y_mm
      // Сдвигаем все placeholder'ы этой ячейки на delta
      for (const ph of cell) {
        if (deltaX !== 0 || deltaY !== 0) {
          overrides[ph.label] = {
            x_mm: ph.x_mm + deltaX,
            y_mm: ph.y_mm + deltaY,
          }
        }
      }
    } else {
      // Лишняя ячейка — скрываем
      for (const ph of cell) {
        overrides[ph.label] = { hidden: true }
      }
    }
  }

  // _head, групповое и другие placeholder'ы без _N — не трогаем
  void otherPlaceholders

  return {
    overrides,
    detectedGrid,
    strategy: `${usedCount}/${totalCells} cells — ${fullRows} full rows + ${remainder} centered`,
  }
}
