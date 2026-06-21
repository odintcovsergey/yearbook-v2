/**
 * Сверка A4 (ТЗ docs/tz-step4-deployment.md): доказать, что новый self-hosted
 * PostgREST (Timeweb) отвечает ИДЕНТИЧНО старому Supabase PostgREST — ДО
 * переключения боевого. Сравниваем один и тот же набор PostgREST-запросов на
 * двух бэкендах и диффим нормализованный JSON. Запросы подобраны так, чтобы
 * покрыть PostgREST-специфику (эмбеды, дизамбигуаторы !inner/!fk, .or(),
 * вложенный count, count=exact). Только ЧТЕНИЕ — ничего не пишем.
 *
 * Запуск (через node --env-file, чтобы подхватить .env.local):
 *   node --env-file=.env.local scripts/compare-rest-backends.mjs --self-test
 *       — сравнить Supabase с самим собой (валидация инструмента; всё PASS).
 *   node --env-file=.env.local scripts/compare-rest-backends.mjs
 *       — сравнить Supabase (A) и Timeweb PostgREST (B). Требует переменные:
 *         TIMEWEB_REST_URL   — корень REST нового PostgREST (напр.
 *                              http://127.0.0.1:3001 при прямом доступе, или
 *                              https://host/rest/v1 через nginx).
 *         TIMEWEB_REST_KEY   — опционально (если у PostgREST задан jwt-secret;
 *                              у нас по плану НЕ задан → можно не указывать).
 *
 * Бэкенд A (Supabase) берётся из NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY (service-role, чтобы видеть все строки, как в проде).
 *
 * Детерминизм: каждый запрос обязан иметь order+limit, иначе порядок строк
 * между бэкендами может различаться (это не расхождение данных).
 */

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA_URL || !SUPA_KEY) {
  console.error('Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (.env.local).')
  process.exit(2)
}

const SELF_TEST = process.argv.includes('--self-test')

// Бэкенд A — Supabase (эталон).
const A = {
  name: 'supabase',
  base: `${SUPA_URL.replace(/\/$/, '')}/rest/v1`,
  headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
}

// Бэкенд B — Timeweb PostgREST (или Supabase в self-test).
let B
if (SELF_TEST) {
  B = { ...A, name: 'supabase(self)' }
} else {
  const url = process.env.TIMEWEB_REST_URL
  if (!url) {
    console.error('Нет TIMEWEB_REST_URL. Запусти с --self-test для проверки инструмента, или задай TIMEWEB_REST_URL когда PostgREST поднят.')
    process.exit(2)
  }
  const key = process.env.TIMEWEB_REST_KEY
  B = {
    name: 'timeweb',
    base: url.replace(/\/$/, ''),
    headers: key
      ? { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
      : { Accept: 'application/json' },
  }
}

// ─── Низкоуровневый запрос ───────────────────────────────────────────────────
async function call(backend, path, extraHeaders = {}) {
  const res = await fetch(backend.base + path, { headers: { ...backend.headers, ...extraHeaders } })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body, contentRange: res.headers.get('content-range') }
}

// Стабильная сериализация (рекурсивная сортировка ключей) — порядок ключей в
// JSON не должен влиять на сравнение.
function stable(v) {
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = stable(v[k])
    return out
  }
  return v
}
function norm(x) { return JSON.stringify(stable(x)) }

// ─── Обнаружение «якорей» (реальные id из эталона) ──────────────────────────
async function discover() {
  const pick = async (path, field) => {
    const r = await call(A, path)
    if (r.status === 200 && Array.isArray(r.body) && r.body[0]) return r.body[0][field]
    return null
  }
  return {
    tenantId: await pick('/tenants?select=id&order=id&limit=1', 'id'),
    albumId: await pick('/albums?select=id&order=id&limit=1', 'id'),
    templateSetId: await pick('/template_sets?select=id&order=id&limit=1', 'id'),
  }
}

// ─── РЕАЛЬНЫЕ эмбеды из рантайм-кода (app/ + lib/) ───────────────────────────
// Дедуплицированный список из живого кода: точные строки select со встроенными
// эмбедами, какие supabase-js реально шлёт в PostgREST. Каждый прогоняется как
// чтение с детерминированным порядком (order по PK/составному ключу + limit),
// без рантайм-фильтров — нам важна ЭКВИВАЛЕНТНОСТЬ формы эмбеда на двух бэкендах,
// а не воспроизведение бизнес-фильтра. `order` указывается отдельно (стыковочные
// таблицы photo_children/photo_teachers без id — по составному ключу).
// Поле `where` (опц.) — нашёл место в коде, чтобы при падении было видно откуда.
const REAL_EMBEDS = [
  // albums
  { table: 'albums', order: 'id', select: '*,config_presets!config_preset_id(slug,name)', where: 'tenant/route.ts:823' },
  // children
  { table: 'children', order: 'id', select: 'albums!inner(tenant_id)', where: 'tenant/route.ts:604,619,651,1141' },
  { table: 'children', order: 'id', select: 'album_id,submitted_at,started_at,is_purchased,albums!inner(tenant_id)', where: 'tenant/route.ts:828' },
  { table: 'children', order: 'id', select: 'id,full_name,class,access_token,submitted_at,started_at,is_purchased,config_preset_id,config_presets(slug,name)', where: 'tenant/route.ts:1090' },
  { table: 'children', order: 'id', select: 'album_id,submitted_at,started_at,albums!inner(id,title,city,year,archived,tenant_id,deadline)', where: 'tenant/route.ts:2317' },
  { table: 'children', order: 'id', select: 'id,album_id,albums(personal_spread_enabled,personal_spread_min,personal_spread_max,personal_spread_price,tenant_id,archived)', where: 'personal-spread/route.ts:21' },
  // cover_selections
  { table: 'cover_selections', order: 'id', select: 'surcharge,child_id,children!inner(album_id)', where: 'tenant/route.ts:968' },
  { table: 'cover_selections', order: 'id', select: 'photo_id,children!inner(album_id)', where: 'workflow/originals-zip/route.ts:122' },
  // deals
  { table: 'deals', order: 'id', select: '*,deal_stages(name,color),albums(title,city,year)', where: 'crm/route.ts:79' },
  { table: 'deals', order: 'id', select: '*,deal_stages(name,color),clients(name,city),albums(title,city,year)', where: 'crm/route.ts:106,246,268,285' },
  // personal_spread_photos
  { table: 'personal_spread_photos', order: 'id', select: 'child_id,filename,storage_path,sort_order,id,children(full_name,class)', where: 'tenant/route.ts:2281; spread-download/route.ts:32' },
  // photo_children (составной ключ)
  { table: 'photo_children', order: 'photo_id,child_id', select: 'photo_id,children(full_name)', where: 'tenant/route.ts:1896; originals-zip/route.ts:217' },
  // photo_teachers (составной ключ)
  { table: 'photo_teachers', order: 'photo_id,teacher_id', select: 'teacher_id,photos(filename,storage_path)', where: 'tenant/route.ts:1823,2510' },
  { table: 'photo_teachers', order: 'photo_id,teacher_id', select: 'teacher_id,photos(storage_path)', where: 'build-album-input.ts:146' },
  // presets
  { table: 'presets', order: 'id', select: '*,template_sets!inner(is_published)', where: 'tenant/route.ts:1627' },
  // quote_selections
  { table: 'quote_selections', order: 'id', select: 'quote_id,albums!inner(tenant_id)', where: 'tenant/route.ts:2153' },
  // responsible_parents
  { table: 'responsible_parents', order: 'id', select: 'album_id,access_token,albums!inner(tenant_id)', where: 'tenant/route.ts:832' },
  // selections
  { table: 'selections', order: 'id', select: 'child_id,photos(thumb_path,storage_path)', where: 'tenant/route.ts:1027' },
  { table: 'selections', order: 'id', select: 'photo_id,selection_type,photos(filename,storage_path,thumb_path)', where: 'tenant/route.ts:1149' },
  { table: 'selections', order: 'id', select: 'child_id,photo_id,selection_type,photos(filename)', where: 'tenant/route.ts:2428' },
  { table: 'selections', order: 'id', select: 'child_id,selection_type,photos(storage_path)', where: 'cover/load-covers.ts:93' },
  { table: 'selections', order: 'id', select: 'photos(storage_path)', where: 'cover/parent-gallery.ts:174' },
  // teachers
  { table: 'teachers', order: 'id', select: 'album_id,submitted_at,albums!inner(tenant_id)', where: 'tenant/route.ts:836' },
  // tasks
  { table: 'tasks', order: 'id', select: '*,deals(title),clients(name)', where: 'crm/route.ts:117,314' },
]

// ─── Набор сверочных запросов (читаются, детерминированы) ────────────────────
function buildQueries(a) {
  const tid = a.tenantId ?? '00000000-0000-0000-0000-000000000000'
  const synthetic = [
    // Простые / стандартный SQL
    { name: 'simple: albums select+order+limit', path: '/albums?select=id,title,city,year&order=id&limit=5' },
    { name: 'eq: albums by tenant', path: `/albums?select=id,tenant_id&tenant_id=eq.${tid}&order=id&limit=5` },
    { name: 'is null: global template_sets', path: '/template_sets?select=id,tenant_id&tenant_id=is.null&order=id&limit=5' },
    // PostgREST-специфика: .or() с сырой строкой
    { name: 'or(): tenant|global template_sets', path: `/template_sets?select=id,is_global,tenant_id&or=(tenant_id.is.null,tenant_id.eq.${tid})&order=id&limit=10` },
    // PostgREST-специфика: вложенный count
    { name: 'embed count: template_sets→spread_templates(count)', path: '/template_sets?select=id,spread_templates(count)&order=id&limit=5' },
    // PostgREST-специфика: !inner join
    { name: 'embed !inner: photos→albums!inner(tenant_id)', path: '/photos?select=id,albums!inner(tenant_id)&order=id&limit=5' },
    // PostgREST-специфика: дизамбигуатор по FK-колонке
    { name: 'embed !fk: albums→config_presets!config_preset_id', path: '/albums?select=id,config_presets!config_preset_id(slug,name)&order=id&limit=5' },
    // Многоуровневый эмбед
    { name: 'embed multi: photos→children + albums', path: '/photos?select=id,storage_path,albums!inner(tenant_id,title),children(full_name)&order=id&limit=5' },
    // count=exact (сравниваем заголовок content-range)
    { name: 'count=exact: albums total', path: '/albums?select=id&limit=1', headers: { Prefer: 'count=exact' }, compareContentRange: true },
  ]
  // Реальные эмбеды из кода → детерминированные read-запросы.
  const real = REAL_EMBEDS.map((e) => ({
    name: `real[${e.table}]: ${e.select}  (${e.where})`,
    path: `/${e.table}?select=${encodeURIComponent(e.select)}&order=${e.order}&limit=5`,
  }))
  return [...synthetic, ...real]
}

// ─── Прогон ──────────────────────────────────────────────────────────────────
function diffSnippet(sa, sb) {
  // Найти первое различие, показать окрестность.
  let i = 0
  while (i < sa.length && i < sb.length && sa[i] === sb[i]) i++
  const at = Math.max(0, i - 40)
  return `…${sa.slice(at, i + 40)}  ≠  …${sb.slice(at, i + 40)}`
}

async function run() {
  console.log(`A = ${A.name} (${A.base})`)
  console.log(`B = ${B.name} (${B.base})`)
  console.log(SELF_TEST ? '(self-test: A vs A)\n' : '')

  const anchors = await discover()
  console.log('Якоря:', JSON.stringify(anchors), '\n')

  const queries = buildQueries(anchors)
  let pass = 0, fail = 0
  for (const q of queries) {
    const ra = await call(A, q.path, q.headers ?? {})
    const rb = await call(B, q.path, q.headers ?? {})

    let ok, detail = ''
    if (q.compareContentRange) {
      const ca = (ra.contentRange ?? '').split('/')[1] ?? '?'
      const cb = (rb.contentRange ?? '').split('/')[1] ?? '?'
      ok = ra.status === rb.status && ca === cb
      detail = `count A=${ca} B=${cb} (status ${ra.status}/${rb.status})`
    } else {
      const sa = norm(ra.body), sb = norm(rb.body)
      ok = ra.status === rb.status && sa === sb
      detail = ok
        ? `status ${ra.status}, строк ${Array.isArray(ra.body) ? ra.body.length : '—'}`
        : `status A=${ra.status} B=${rb.status}\n      ${diffSnippet(sa, sb)}`
    }

    console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${q.name}\n      ${detail}`)
    ok ? pass++ : fail++
  }

  console.log(`\nИТОГ: ${pass} PASS, ${fail} FAIL`)
  process.exit(fail === 0 ? 0 : 1)
}

run().catch((e) => { console.error('Ошибка прогона:', e); process.exit(2) })
