'use client'

/**
 * Клиентская проверка разрешения фона ПЕРЕД загрузкой (правка №7 ветки
 * fix/logo-qr-bg-timeweb). Мягкость фонов в печати во многом от мелких
 * исходников: фон тянется на ВЕСЬ разворот, и при печати 300 dpi мелкая
 * картинка выходит размытой. Ловим это сразу при загрузке — предупреждаем
 * партнёра/дизайнера, но не блокируем (вдруг фон намеренно небольшой).
 *
 * Порог: layflat-разворот ~452 мм по ширине. 3000 px по длинной стороне ≈
 * 168 dpi на разворот — нижняя граница приемлемой мягкости для фоновой
 * (не детальной) графики. Ниже — предупреждаем.
 */
export const BG_MIN_LONG_SIDE_PX = 3000

/** Размеры картинки в пикселях или null, если прочитать не удалось. */
export async function readImageSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file)
      const size = { width: bmp.width, height: bmp.height }
      bmp.close?.()
      return size
    }
  } catch {
    // падаем во fallback ниже
  }
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
        URL.revokeObjectURL(url)
      }
      img.onerror = () => {
        resolve(null)
        URL.revokeObjectURL(url)
      }
      img.src = url
    } catch {
      resolve(null)
    }
  })
}

/**
 * Если фон мельче порога — спросить подтверждение через confirm().
 * Возвращает true, если можно продолжать загрузку (размер ок, размер прочитать
 * не удалось, или партнёр подтвердил), false — если партнёр отказался.
 */
export async function confirmBackgroundResolution(file: File): Promise<boolean> {
  const size = await readImageSize(file)
  if (!size) return true // не смогли прочитать — не мешаем
  const longSide = Math.max(size.width, size.height)
  if (longSide >= BG_MIN_LONG_SIDE_PX) return true
  return window.confirm(
    `Фон «${file.name}» мелковат: ${size.width}×${size.height} px.\n\n` +
      `Для печати разворота (300 dpi) рекомендуется не меньше ` +
      `${BG_MIN_LONG_SIDE_PX} px по длинной стороне — иначе в книге фон может ` +
      `выйти мягким/размытым.\n\nВсё равно загрузить?`,
  )
}
