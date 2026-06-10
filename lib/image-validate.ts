/**
 * D3 (аудит безопасности): проверка, что загружаемый файл — действительно
 * изображение, по «магическим байтам» (сигнатуре), а не по расширению или
 * заголовку content-type от клиента (их легко подделать).
 *
 * Поддерживаем форматы, которые реально приходят с телефонов и камер:
 * JPEG, PNG, WebP, GIF, HEIC/HEIF. Проверка не зависит от sharp (важно для
 * HEIC, который sharp без libheif не декодирует).
 */

// Разумный потолок для одного фото (оригиналы с камеры бывают крупные).
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024 // 25 МБ

export function isSupportedImage(buf: Buffer): boolean {
  if (buf.length < 12) return false

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true

  // GIF: 'GIF8'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true

  // WebP: 'RIFF' .... 'WEBP'
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true

  // HEIC/HEIF: байты 4-7 = 'ftyp', далее бренд (heic/heix/mif1/msf1/hevc/heim…)
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.slice(8, 12).toString('ascii')
    if (/^(heic|heix|hevc|heim|heis|hevm|hevs|mif1|msf1)$/.test(brand)) return true
  }

  return false
}
