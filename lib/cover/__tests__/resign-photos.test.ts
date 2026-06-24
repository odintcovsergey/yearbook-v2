import { describe, it, expect } from 'vitest'
import { photoKeyFromUrl, keyifyCoverPhotoData } from '../resign-photos'

describe('photoKeyFromUrl', () => {
  it('Timeweb path-style: срезает бакет, возвращает ключ', () => {
    const url =
      'https://s3.twcstorage.ru/270a3206-b702-4ab1-9559-195068ed251a/def23fce/portrait/1779391292221_DSC08440.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260621T060000Z'
    expect(photoKeyFromUrl(url)).toBe('def23fce/portrait/1779391292221_DSC08440.webp')
  })

  it('Supabase public: ключ после /object/public/<bucket>/', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/public/photos/tenants/x/logo.webp?t=123'
    expect(photoKeyFromUrl(url)).toBe('tenants/x/logo.webp')
  })

  it('Supabase signed: ключ после /object/sign/<bucket>/', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/sign/photos/album/portrait/p.webp?token=xyz'
    expect(photoKeyFromUrl(url)).toBe('album/portrait/p.webp')
  })

  it('Yandex virtual-hosted: весь путь — ключ', () => {
    const url = 'https://yearbook-photos.storage.yandexcloud.net/album/portrait/p.jpg?sig=1'
    expect(photoKeyFromUrl(url)).toBe('album/portrait/p.jpg')
  })

  it('незнакомый URL → null (значение не трогаем)', () => {
    expect(photoKeyFromUrl('https://example.com/foo/bar.jpg')).toBeNull()
  })
})

describe('keyifyCoverPhotoData', () => {
  it('подписанные фото-URL → ключи, текст и __bg__ не трогает', () => {
    const out = keyifyCoverPhotoData({
      cover_portrait:
        'https://s3.twcstorage.ru/bucket/album/portrait/p.webp?X-Amz-Date=20260621T060000Z',
      back_logo: 'https://abc.supabase.co/storage/v1/object/public/photos/tenants/x/logo.webp',
      cover_title: 'Выпуск 2026',
      __bg__: 'album-covers/x/y.jpg',
      cover_year: '2026',
    })
    expect(out.cover_portrait).toBe('album/portrait/p.webp')
    expect(out.back_logo).toBe('tenants/x/logo.webp')
    expect(out.cover_title).toBe('Выпуск 2026') // текст не трогаем
    expect(out.__bg__).toBe('album-covers/x/y.jpg') // фон — отдельный путь
    expect(out.cover_year).toBe('2026')
  })

  it('значение-ключ (уже без http) остаётся как есть', () => {
    const out = keyifyCoverPhotoData({ cover_portrait: 'album/portrait/p.webp' })
    expect(out.cover_portrait).toBe('album/portrait/p.webp')
  })
})
