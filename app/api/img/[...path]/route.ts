import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Прокси для фото из Supabase Storage
// Нужен потому что supabase.co недоступен из РФ/Казахстана без VPN
// Клиент обращается к yearbook-v2.vercel.app/api/img/... (работает везде)
// Vercel забирает файл из Supabase сервер→сервер (тоже работает)

export async function GET(
  _req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const storagePath = params.path.join('/')
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl || !storagePath) {
    return new NextResponse('Not found', { status: 404 })
  }

  const fileUrl = `${supabaseUrl}/storage/v1/object/public/photos/${storagePath}`

  try {
    const res = await fetch(fileUrl, { cache: 'no-store' })
    if (!res.ok) {
      return new NextResponse('Not found', { status: res.status })
    }

    const contentType = res.headers.get('content-type') ?? 'image/webp'
    const body = await res.arrayBuffer()

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        // Кэш в браузере на 7 дней — повторные открытия не тратят трафик
        'Cache-Control': 'public, max-age=604800, immutable',
      },
    })
  } catch {
    return new NextResponse('Error fetching image', { status: 502 })
  }
}
