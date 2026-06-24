import { describe, it, expect } from 'vitest'
import { coverBgKeyFromValue } from '../resign-bg'
import { signCoverBg } from '../editor-merge'

describe('coverBgKeyFromValue', () => {
  it('относительный ключ → как есть', () => {
    expect(coverBgKeyFromValue('album-covers/abc/uuid.jpg')).toBe('album-covers/abc/uuid.jpg')
  })

  it('ведущий слэш и затесавшийся bucket-префикс срезаются', () => {
    expect(coverBgKeyFromValue('/album-covers/x.jpg')).toBe('album-covers/x.jpg')
    expect(coverBgKeyFromValue('template-backgrounds/album-covers/x.jpg')).toBe('album-covers/x.jpg')
  })

  it('Supabase public-URL → ключ после /template-backgrounds/', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/public/template-backgrounds/album-covers/a/b.jpg?t=1'
    expect(coverBgKeyFromValue(url)).toBe('album-covers/a/b.jpg')
  })

  it('Supabase signed-URL → ключ после /template-backgrounds/', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/sign/template-backgrounds/album-covers/a/b.jpg?token=xyz'
    expect(coverBgKeyFromValue(url)).toBe('album-covers/a/b.jpg')
  })

  it('протухший presigned Timeweb path-style → ключ после /template-backgrounds/', () => {
    const url =
      'https://s3.twcstorage.ru/270a3206-bucket/template-backgrounds/album-covers/a/b.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260601T000000Z'
    expect(coverBgKeyFromValue(url)).toBe('album-covers/a/b.jpg')
  })

  it('чужой URL без template-backgrounds → null (не трогаем)', () => {
    expect(coverBgKeyFromValue('https://example.com/foo/bar.jpg')).toBeNull()
  })
})

describe('signCoverBg — карта проверяется первой (фикс протухших полных URL)', () => {
  const supaUrl =
    'https://abc.supabase.co/storage/v1/object/public/template-backgrounds/album-covers/x.jpg'
  const signed = 'https://s3.twcstorage.ru/bucket/template-backgrounds/album-covers/x.jpg?X-Amz-Date=now'

  it('полный (старый) URL заменяется на свежую подпись из карты', () => {
    expect(signCoverBg(supaUrl, { [supaUrl]: signed })).toBe(signed)
  })

  it('относительный ключ берёт подпись из карты', () => {
    expect(signCoverBg('album-covers/x.jpg', { 'album-covers/x.jpg': signed })).toBe(signed)
  })

  it('нет карты (supabase-режим) → значение как есть', () => {
    expect(signCoverBg(supaUrl, undefined)).toBe(supaUrl)
    expect(signCoverBg('album-covers/x.jpg', null)).toBe('album-covers/x.jpg')
  })

  it('пусто → null', () => {
    expect(signCoverBg(null, { a: 'b' })).toBeNull()
  })
})
