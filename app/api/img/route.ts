/**
 * Same-origin image proxy для превью обложек (и любых SVG-превью).
 *
 * Зачем: в инлайн-SVG картинки из ЧУЖОГО origin (хранилище s3.twcstorage.ru /
 * supabase) Safari/WebKit грузит ненадёжно — то требует CORS-заголовок (которого
 * Timeweb без Origin не отдаёт), то конфликтует с no-cors кэшем холста → фон/
 * портреты превращаются в «?». Решение: отдать картинку с НАШЕГО домена. Тогда
 * для браузера это same-origin — никаких CORS/кэш-граблей, рисуется во всех
 * браузерах.
 *
 * Доступ не расширяется: проксируем только уже ПОДПИСАННУЮ ссылку (presigned —
 * она и есть пропуск), хост — из белого списка (анти-SSRF). Новых прав не даёт:
 * ту же ссылку можно открыть и напрямую.
 */
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Хосты нашего хранилища (анти-SSRF: чужие URL не проксируем). */
function allowedHost(host: string): boolean {
  return (
    host === 's3.twcstorage.ru' ||
    host.endsWith('.twcstorage.ru') ||
    host.endsWith('.supabase.co') ||
    host === 'app.okeybook.ru'
  )
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get('u')
  if (!u) return new Response('missing u', { status: 400 })

  let host: string
  try {
    host = new URL(u).host
  } catch {
    return new Response('bad u', { status: 400 })
  }
  if (!allowedHost(host)) return new Response('forbidden host', { status: 403 })

  let upstream: Response
  try {
    upstream = await fetch(u)
  } catch {
    return new Response('upstream fetch failed', { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return new Response('upstream ' + upstream.status, { status: 502 })
  }

  const ct = upstream.headers.get('content-type') ?? 'application/octet-stream'
  // Только картинки (защита от проксирования произвольного контента).
  if (!ct.startsWith('image/')) return new Response('not an image', { status: 415 })

  const buf = Buffer.from(await upstream.arrayBuffer())
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': ct,
      // private: ссылка живёт ~окно подписи; кэшируем у браузера пользователя.
      'Cache-Control': 'private, max-age=21600',
    },
  })
}
