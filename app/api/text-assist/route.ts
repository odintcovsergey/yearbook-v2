import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MODEL = 'claude-haiku-4-5'

type Action = 'fix'

const ACTIONS: ReadonlySet<Action> = new Set<Action>(['fix'])

function buildPrompt(action: Action, text: string, maxChars: number): string {
  if (action === 'fix') {
    return `Ты помогаешь школьнику оформить текст для выпускного альбома.

Исходный текст:
"${text}"

Задача: исправь ТОЛЬКО орфографические и грамматические ошибки, расставь знаки препинания. НЕ меняй смысл, стиль, порядок слов и длину текста. Не добавляй и не убирай мысли. Не украшай.

Лимит: ${maxChars} символов. Если исходный текст укладывается — сохрани его длину. Не превышай лимит.

Верни ТОЛЬКО исправленный текст, без кавычек, без пояснений.`
  }
  throw new Error(`unknown action: ${action}`)
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI-помощник пока не настроен. Обратитесь к организатору.' },
      { status: 503 },
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const action = body?.action as Action
  const text = typeof body?.text === 'string' ? body.text.trim() : ''

  if (!token) return NextResponse.json({ error: 'Токен не указан' }, { status: 400 })
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'Текст пустой' }, { status: 400 })

  const { data: child, error: childErr } = await supabaseAdmin
    .from('children')
    .select('id, album_id')
    .eq('access_token', token)
    .single()
  if (childErr || !child) {
    return NextResponse.json({ error: 'Ссылка недействительна' }, { status: 404 })
  }

  const { data: album } = await supabaseAdmin
    .from('albums')
    .select('id, text_enabled, text_max_chars, text_type, text_assist_enabled, deadline')
    .eq('id', (child as any).album_id)
    .single()

  if (!album || !(album as any).text_enabled) {
    return NextResponse.json({ error: 'Текстовый блок выключен' }, { status: 403 })
  }
  if (!(album as any).text_assist_enabled) {
    return NextResponse.json({ error: 'AI-помощник для этого альбома не включён' }, { status: 403 })
  }
  const textType = (album as any).text_type as string | null
  if (textType !== 'free' && textType !== 'grade11') {
    return NextResponse.json({ error: 'AI-помощник пока доступен только для свободного текста и 11 класса' }, { status: 403 })
  }
  if ((album as any).deadline && new Date((album as any).deadline) < new Date()) {
    return NextResponse.json({ error: 'Срок истёк' }, { status: 410 })
  }

  const maxChars = Number((album as any).text_max_chars) || 500

  if (text.length > maxChars * 1.5) {
    return NextResponse.json({ error: 'Текст слишком длинный' }, { status: 400 })
  }

  const prompt = buildPrompt(action, text, maxChars)
  const client = new Anthropic({ apiKey })

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    })
    const part = resp.content.find((b: any) => b.type === 'text') as any
    const raw: string = part?.text ?? ''
    let result = raw.trim().replace(/^["«»]+|["«»]+$/g, '').trim()
    if (!result) {
      return NextResponse.json({ error: 'AI вернул пустой ответ, попробуйте ещё раз' }, { status: 502 })
    }
    if (result.length > maxChars) {
      const cut = result.slice(0, maxChars)
      const lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'))
      result = lastDot > maxChars * 0.5 ? cut.slice(0, lastDot + 1) : cut
    }
    return NextResponse.json({ result })
  } catch (e: any) {
    const msg = e?.message ?? 'Ошибка AI-помощника'
    console.error('[text-assist] anthropic error', msg)
    return NextResponse.json({ error: 'AI-помощник временно недоступен, попробуйте ещё раз' }, { status: 502 })
  }
}
