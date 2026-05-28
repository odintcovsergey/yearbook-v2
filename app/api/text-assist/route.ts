import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MODEL = 'claude-haiku-4-5'

type Action = 'fix' | 'improve' | 'form_grade4' | 'form_garden' | 'form_grade11'

const ACTIONS: ReadonlySet<Action> = new Set<Action>(['fix', 'improve', 'form_grade4', 'form_garden', 'form_grade11'])

const SHORT_THRESHOLD = 150

const GRADE4_FIELD_LABELS: Record<string, string> = {
  hobby: 'Любимое хобби',
  profession: 'Кем хочет стать',
  dream: 'О чём мечтает',
  superpower: 'Суперспособность',
  wish: 'Пожелание классу/школе',
}

const GARDEN_FIELD_LABELS: Record<string, string> = {
  game: 'Любимая игра',
  food: 'Любимая еда',
  profession: 'Кем хочет стать когда вырастет',
  love: 'Что любит больше всего',
}

const GRADE11_FIELD_LABELS: Record<string, string> = {
  memory: 'Что запомнится из школьных лет',
  hobby: 'Чем увлекается, что важно',
  future: 'Кем видит себя в будущем, о чём мечтает',
  gratitude: 'За что благодарен школе или учителям',
  wish: 'Что пожелает одноклассникам',
}

function formatFields(fields: Record<string, string>, labels: Record<string, string>): string {
  const lines: string[] = []
  for (const key of Object.keys(labels)) {
    const value = (fields[key] ?? '').trim()
    if (value) lines.push(`- ${labels[key]}: ${value}`)
  }
  return lines.join('\n')
}

function buildPromptFix(text: string, maxChars: number): string {
  return `Ты помогаешь школьнику оформить текст для выпускного альбома.

Исходный текст:
"${text}"

Задача: исправь ТОЛЬКО орфографические и грамматические ошибки, расставь знаки препинания. НЕ меняй смысл, стиль, порядок слов и длину текста. Не добавляй и не убирай мысли. Не украшай.

Лимит: ${maxChars} символов. Если исходный текст укладывается — сохрани его длину. Не превышай лимит.

Верни ТОЛЬКО исправленный текст, без кавычек, без пояснений.`
}

function buildPromptImprove(text: string, maxChars: number): string {
  if (maxChars <= SHORT_THRESHOLD) {
    return `Ты помогаешь школьнику оформить короткую подпись для выпускного альбома.

Исходный текст:
"${text}"

Задача: исправь ошибки и слегка причеши формулировку. Текст очень короткий — НЕ удлиняй его, не добавляй новые мысли. Просто сделай грамотнее и чуть изящнее в пределах той же длины.

Лимит: СТРОГО не более ${maxChars} символов.

Верни ТОЛЬКО результат, без кавычек, без пояснений.`
  }
  return `Ты помогаешь школьнику красиво оформить текст для выпускного альбома.

Исходный текст:
"${text}"

Задача: исправь ошибки и сделай текст более тёплым, связным и красивым. СОХРАНИ основной смысл и индивидуальность автора — это личный текст, а не шаблон. Не выдумывай факты которых нет.

Лимит: СТРОГО не более ${maxChars} символов. Это критично.

Тон: искренний, живой, подходящий для выпускного альбома. Избегай канцелярита и пафоса.

Верни ТОЛЬКО улучшенный текст, без кавычек, без пояснений.`
}

function buildPromptFormGrade4(fields: Record<string, string>, maxChars: number): string {
  const formatted = formatFields(fields, GRADE4_FIELD_LABELS)
  return `Ты помогаешь ученику 4 класса оформить текст о себе для выпускного альбома начальной школы.

Ученик рассказал о себе:
${formatted}

Составь короткий искренний рассказ от первого лица на основе этих ответов.

ЖЁСТКИЕ ТРЕБОВАНИЯ (важнее всего остального):
1. Имя ребёнка НЕ упоминай. Его нет в данных, придумывать или ставить заглушку («Меня зовут…») нельзя. Начни сразу с содержания.
2. ЗАПРЕЩЕНЫ формулы представления: «Меня зовут», «Привет, я», «Здравствуйте», «Я учусь в…», «Меня называют».
3. Пиши литературным русским языком, грамматически и стилистически правильно. Избегай неестественных оборотов: не «волшебные запахи, которые дарят улыбку», не «это дарит мне радость и спокойствие», не «собственное мороженое, где люди приходят и улыбаются». Пиши живо и просто, как реальный 10-летний ребёнок.
4. Детский тон и непосредственность, но без сюсюканья и без канцеляризмов.
5. Не выдумывай факты, которых нет в анкете. Пропущенные поля просто не упоминай.
6. Сделай текст уникальным — без шаблонных оборотов типа «эти годы были для меня…».
7. Между предложениями и абзацами НЕ ставь пустые строки. Абзацы можно (новая строка), но БЕЗ пустой строки между ними. Никаких двойных переносов \\n\\n.

Лимит: СТРОГО не более ${maxChars} символов.

Верни ТОЛЬКО текст, без кавычек, без пояснений, без подписи.`
}

function buildPromptFormGrade11(fields: Record<string, string>, maxChars: number): string {
  const formatted = formatFields(fields, GRADE11_FIELD_LABELS)
  const shortHint = maxChars <= SHORT_THRESHOLD
    ? '\nЛимит очень маленький — выбери самое главное из ответов, остальное оставь, не пытайся вместить всё.'
    : '\nЕсли лимит позволяет, можно несколько коротких абзацев; если ответов мало — сделай короче.'
  return `Ты помогаешь старшекласснику оформить текст о себе для выпускного альбома. Текст от первого лица, искренний и живой, без пафоса и канцелярита. Тон взрослый, но тёплый — это прощание со школой.

Ученик ответил на вопросы:
${formatted}

Составь связный искренний текст от первого лица на основе ответов.

ЖЁСТКИЕ ТРЕБОВАНИЯ (важнее всего остального):
1. Имя ученика НЕ упоминай. Его нет в данных, придумывать или ставить заглушку («Меня зовут…») нельзя. Начни сразу с содержания.
2. ЗАПРЕЩЕНЫ формулы представления: «Меня зовут», «Привет, я», «Здравствуйте», «Я учусь в…».
3. ЗАПРЕЩЕНЫ шаблонные обороты: «школьные годы пролетели незаметно», «эти годы запомнятся навсегда», «спасибо за всё», «впереди новая жизнь», «я никогда не забуду». Пиши своими словами.
4. Литературный русский, без канцеляризмов и пафоса. Никаких неестественных конструкций типа «дарит мне X и Y».
5. Сохрани индивидуальность ученика — не превращай в шаблонную выпускную речь.
6. Не выдумывай факты которых нет в ответах. Пропущенные поля просто не упоминай.${shortHint}
7. Между предложениями и абзацами НЕ ставь пустые строки. Абзацы можно (новая строка), но БЕЗ пустой строки между ними. Никаких двойных переносов \\n\\n.

Лимит: СТРОГО не более ${maxChars} символов.

Верни ТОЛЬКО текст, без кавычек, без пояснений, без подписи.`
}

function buildPromptFormGarden(fields: Record<string, string>, maxChars: number): string {
  const formatted = formatFields(fields, GARDEN_FIELD_LABELS)
  return `Ты помогаешь составить текст о ребёнке-дошкольнике для выпускного альбома детского сада.

Ребёнок рассказал:
${formatted}

Составь короткий милый рассказ от первого лица малыша.

ЖЁСТКИЕ ТРЕБОВАНИЯ (важнее всего остального):
1. Имя ребёнка НЕ упоминай. Его нет в данных, придумывать или оставлять «Меня зовут…» нельзя. Начни сразу с содержания.
2. ЗАПРЕЩЕНЫ формулы представления: «Меня зовут», «Привет, я», «Здравствуйте», «Меня называют».
3. Простые короткие предложения, как у пяти-шестилетнего ребёнка. Без сложных оборотов, без канцеляризмов.
4. Тёплый и непосредственный тон, но без сюсюканья.
5. Не выдумывай факты, которых нет в анкете. Пропущенные поля просто не упоминай.
6. Сделай текст уникальным — без шаблонных прощаний типа «До свидания, детский сад!».
7. Между предложениями и абзацами НЕ ставь пустые строки. Абзацы можно (новая строка), но БЕЗ пустой строки между ними. Никаких двойных переносов \\n\\n.

Лимит: СТРОГО не более ${maxChars} символов.

Верни ТОЛЬКО текст, без кавычек, без пояснений, без подписи.`
}

function buildShrinkPrompt(previous: string, maxChars: number): string {
  return `Сократи текст ниже строго до ${maxChars} символов, сохраняя смысл, тон и грамотность. Не добавляй кавычек, верни только результат.

Текст:
"${previous}"`
}

function cleanText(raw: string): string {
  return raw.trim().replace(/^["«»]+|["«»]+$/g, '').trim()
}

async function callClaude(client: Anthropic, prompt: string, temperature: number): Promise<string> {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature,
    messages: [{ role: 'user', content: prompt }],
  })
  const part = resp.content.find((b: any) => b.type === 'text') as any
  return cleanText(part?.text ?? '')
}

function hardTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'))
  return lastDot > maxChars * 0.5 ? cut.slice(0, lastDot + 1) : cut
}

function sanitizeFields(input: any): Record<string, string> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') {
      const trimmed = v.trim()
      if (trimmed) out[k] = trimmed.slice(0, 300)
    }
  }
  return out
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

  if (!token) return NextResponse.json({ error: 'Токен не указан' }, { status: 400 })
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })

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
  if ((album as any).deadline && new Date((album as any).deadline) < new Date()) {
    return NextResponse.json({ error: 'Срок истёк' }, { status: 410 })
  }

  const textType = (album as any).text_type as string | null
  if (action === 'form_grade4' && textType !== 'grade4') {
    return NextResponse.json({ error: 'Анкета 4 класса доступна только для альбомов начальной школы' }, { status: 403 })
  }
  if (action === 'form_garden' && textType !== 'garden') {
    return NextResponse.json({ error: 'Анкета доступна только для альбомов детского сада' }, { status: 403 })
  }
  if (action === 'form_grade11' && textType !== 'grade11') {
    return NextResponse.json({ error: 'Анкета доступна только для альбомов выпускных классов' }, { status: 403 })
  }

  const maxChars = Number((album as any).text_max_chars) || 500

  let prompt: string
  if (action === 'fix' || action === 'improve') {
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) return NextResponse.json({ error: 'Текст пустой' }, { status: 400 })
    if (text.length > maxChars * 1.5) {
      return NextResponse.json({ error: 'Текст слишком длинный' }, { status: 400 })
    }
    prompt = action === 'fix' ? buildPromptFix(text, maxChars) : buildPromptImprove(text, maxChars)
  } else {
    const fields = sanitizeFields(body?.fields)
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'Заполните хотя бы одно поле анкеты' }, { status: 400 })
    }
    if (action === 'form_grade4') prompt = buildPromptFormGrade4(fields, maxChars)
    else if (action === 'form_garden') prompt = buildPromptFormGarden(fields, maxChars)
    else prompt = buildPromptFormGrade11(fields, maxChars)
  }

  const client = new Anthropic({ apiKey })
  const temperature = action === 'fix' ? 0.3 : 0.8

  const isForm = action === 'form_grade4' || action === 'form_garden' || action === 'form_grade11'

  try {
    let result = await callClaude(client, prompt, temperature)
    let truncated = false

    if (isForm) {
      result = result.replace(/\r\n/g, '\n').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').replace(/[ \t]+/g, ' ').trim()
    }

    let attempts = 0
    while (result.length > maxChars && attempts < 2) {
      attempts++
      result = await callClaude(client, buildShrinkPrompt(result, maxChars), temperature)
      if (isForm) {
        result = result.replace(/\r\n/g, '\n').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').replace(/[ \t]+/g, ' ').trim()
      }
    }

    if (!result) {
      return NextResponse.json({ error: 'AI вернул пустой ответ, попробуйте ещё раз' }, { status: 502 })
    }

    if (result.length > maxChars) {
      result = hardTruncate(result, maxChars)
      truncated = true
    }

    return NextResponse.json({ result, truncated })
  } catch (e: any) {
    const msg = e?.message ?? 'Ошибка AI-помощника'
    console.error('[text-assist] anthropic error', msg)
    return NextResponse.json({ error: 'AI-помощник временно недоступен, попробуйте ещё раз' }, { status: 502 })
  }
}
