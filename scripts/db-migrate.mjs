/**
 * Применение миграции к Timeweb Postgres + авто-reload схемы PostgREST.
 * Процедура — см. docs/tz-step4-deployment.md, раздел «Процедура миграций».
 *
 * После переезда Supabase Studio нет; структурные миграции применяем к Timeweb
 * и ОБЯЗАТЕЛЬНО перезагружаем кэш схемы PostgREST (иначе новые колонки/таблицы
 * вернут «column not found», пока кэш старый).
 *
 * Запуск (через psql из postgresql@18, SSL как в шаге 1 — см. ca.crt):
 *   node --env-file=.env.local scripts/db-migrate.mjs <файл.sql> [опции]
 *
 * Опции:
 *   --reload    после применения послать PostgREST `NOTIFY pgrst, 'reload schema'`
 *               (нужно для СТРУКТУРНЫХ миграций: таблицы/колонки/связи/функции;
 *               для чистых изменений данных не нужно).
 *   --url <s>   строка подключения (по умолчанию $TIMEWEB_DATABASE_URL).
 *   --confirm   реально выполнить. БЕЗ него — сухой прогон (только показать план).
 *
 * Защита: без --confirm ничего не делает; отказывается работать с URL,
 * похожим на Supabase (боевой источник трогаем только вручную до cutover).
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const reload = args.includes('--reload')
const confirm = args.includes('--confirm')
const urlIdx = args.indexOf('--url')
const url = urlIdx !== -1 ? args[urlIdx + 1] : process.env.TIMEWEB_DATABASE_URL

function fail(msg) { console.error('✖ ' + msg); process.exit(2) }

if (!file) fail('Укажи файл миграции: scripts/db-migrate.mjs migrations/2026-..-..-x.sql [--reload] [--confirm]')
if (!existsSync(file)) fail(`Файл не найден: ${file}`)
if (!url) fail('Нет строки подключения (--url или $TIMEWEB_DATABASE_URL).')
if (/supabase/i.test(url)) fail('URL похож на Supabase — этим скриптом боевой источник НЕ трогаем. Только Timeweb.')

let host = '?'
try { host = new URL(url).host } catch { /* строка psql без url-формата */ }

console.log('План миграции:')
console.log(`  файл:   ${file}`)
console.log(`  цель:   ${host}`)
console.log(`  reload: ${reload ? 'да (NOTIFY pgrst reload schema)' : 'нет (только данные)'}`)
if (!confirm) {
  console.log('\nСухой прогон. Для реального применения добавь --confirm.')
  process.exit(0)
}

// Подсказка по SSL: шаг 1 использовал verify-ca с ca.crt. Если в url нет
// sslmode, а в корне есть ca.crt — подскажем (psql возьмёт PGSSLROOTCERT).
if (!/sslmode=/.test(url) && existsSync('ca.crt')) {
  process.env.PGSSLROOTCERT = process.env.PGSSLROOTCERT || 'ca.crt'
  console.log('  (SSL: PGSSLROOTCERT=ca.crt; при необходимости добавь ?sslmode=verify-ca в URL)')
}

try {
  console.log('\n→ Применяю миграцию…')
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', file], { stdio: 'inherit' })
  console.log('✓ Миграция применена.')
  if (reload) {
    console.log('→ Перезагружаю кэш схемы PostgREST…')
    execFileSync('psql', [url, '-c', "NOTIFY pgrst, 'reload schema';"], { stdio: 'inherit' })
    console.log('✓ Reload отправлен (если меняли связи/FK — добавь и reload config).')
  }
  console.log('\nНе забудь продублировать структурное изменение в schema.sql.')
} catch (e) {
  fail('psql завершился с ошибкой (см. вывод выше). ' + (e.message ?? ''))
}
