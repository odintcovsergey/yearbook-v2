/**
 * Фаза 2 безопасности (D1): закрытие приватного бакета yearbook-photos.
 *
 * Снимает public-read ACL со ВСЕХ объектов бакета (ставит ACL=private),
 * чтобы старые прямые (неподписанные) ссылки на фото детей перестали
 * работать. Доступ остаётся только через signed URL (Фаза 1, уже в проде).
 *
 * Запускает СЕРГЕЙ локально с ПРОД-кредами YC (у Claude доступа нет):
 *
 *   1. Прописать прод-креды в окружение (НЕ коммитить!). Либо временно
 *      добавить в .env.local, либо экспортировать в shell:
 *        export YC_ACCESS_KEY_ID=...
 *        export YC_SECRET_ACCESS_KEY=...
 *        export YC_BUCKET_NAME=yearbook-photos   # опционально, это дефолт
 *
 *   2. СУХОЙ ПРОГОН (ничего не меняет, только считает):
 *        node --import tsx scripts/yc-make-private.ts
 *      или, если креды в .env.local:
 *        node --env-file=.env.local --import tsx scripts/yc-make-private.ts
 *
 *   3. РЕАЛЬНОЕ ЗАКРЫТИЕ (меняет ACL):
 *        node --import tsx scripts/yc-make-private.ts --apply
 *
 *   4. После скрипта — в консоли YC: бакет → Безопасность → Права доступа →
 *      «Чтение объектов» поставить «Ограниченный». Это убирает публичный
 *      доступ на уровне бакета (скрипт убирает на уровне объектов).
 *
 *   5. Проверка: взять прямую ссылку фото БЕЗ ?X-Amz-... → должна давать
 *      AccessDenied. Открыть рабочие экраны (родительская/кабинет/PDF/ZIP)
 *      → фото грузятся (через signed). Если что-то сломалось — вернуть
 *      «Чтение объектов» в «Публичный» (мгновенный откат) и написать Claude.
 *
 * Операция ОБРАТИМА: ACL можно вернуть, файлы не удаляются.
 */

import {
  S3Client,
  ListObjectsV2Command,
  PutObjectAclCommand,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3'

const BUCKET = process.env.YC_BUCKET_NAME ?? 'yearbook-photos'
const APPLY = process.argv.includes('--apply')
// Параллелизм PutObjectAcl. Умеренный, чтобы не упереться в лимиты YC.
const CONCURRENCY = 16

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`✗ Не задана переменная окружения ${name}. См. инструкцию в шапке скрипта.`)
    process.exit(1)
  }
  return v
}

const s3 = new S3Client({
  endpoint: 'https://storage.yandexcloud.net',
  region: 'ru-central1',
  credentials: {
    accessKeyId: requireEnv('YC_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('YC_SECRET_ACCESS_KEY'),
  },
})

async function listAllKeys(): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined = undefined
  let page = 0
  do {
    const res: ListObjectsV2CommandOutput = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    )
    for (const o of res.Contents ?? []) {
      if (o.Key) keys.push(o.Key)
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
    page++
    process.stdout.write(`\r  Листинг: страница ${page}, найдено ${keys.length} объектов…`)
  } while (token)
  process.stdout.write('\n')
  return keys
}

// Группировка для понятного отчёта (та же логика, что в /api/yc-stats).
function categoryOf(key: string): string {
  if (/\/originals\//.test(key)) return 'originals'
  if (/\/exports\//.test(key)) return 'exports'
  if (/\/delivery\//.test(key)) return 'delivery'
  if (/\/personal\//.test(key)) return 'personal'
  if (/\/portrait\//.test(key)) return 'portrait'
  if (/\/group\//.test(key)) return 'group'
  if (/\/teacher\//.test(key)) return 'teacher'
  if (/\/common_/.test(key)) return 'common'
  if (/\/thumbs\//.test(key)) return 'thumbs'
  if (key.startsWith('tenants/')) return 'tenants'
  return 'other'
}

async function main() {
  console.log(`\nБакет: ${BUCKET}`)
  console.log(`Режим: ${APPLY ? '⚠️  APPLY (меняю ACL на private)' : 'СУХОЙ ПРОГОН (ничего не меняю)'}\n`)

  const keys = await listAllKeys()

  const byCat: Record<string, number> = {}
  for (const k of keys) byCat[categoryOf(k)] = (byCat[categoryOf(k)] ?? 0) + 1
  console.log(`\nВсего объектов: ${keys.length}`)
  console.log('По категориям:')
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(12)} ${n}`)
  }

  if (!APPLY) {
    console.log('\nЭто сухой прогон — ACL не менялись.')
    console.log('Для реального закрытия запустите с флагом --apply.\n')
    return
  }

  console.log(`\nСтавлю ACL=private на ${keys.length} объектов (параллельно по ${CONCURRENCY})…`)
  let done = 0
  let failed = 0
  const failedKeys: string[] = []

  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const batch = keys.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (Key) => {
        try {
          await s3.send(new PutObjectAclCommand({ Bucket: BUCKET, Key, ACL: 'private' }))
        } catch (e: any) {
          failed++
          if (failedKeys.length < 50) failedKeys.push(`${Key} — ${e?.message ?? 'err'}`)
        }
        done++
      }),
    )
    process.stdout.write(`\r  Обработано ${done}/${keys.length} (ошибок: ${failed})…`)
  }
  process.stdout.write('\n')

  console.log(`\nГотово. Успешно: ${done - failed}, ошибок: ${failed}`)
  if (failedKeys.length > 0) {
    console.log('\nПервые ошибки:')
    for (const f of failedKeys) console.log(`  ✗ ${f}`)
  }
  console.log(
    '\nДальше: в консоли YC поставить «Чтение объектов» → «Ограниченный»,\n' +
      'затем проверить, что прямая (неподписанная) ссылка даёт AccessDenied,\n' +
      'а рабочие экраны показывают фото через signed URL.\n',
  )
}

main().catch((e) => {
  console.error('\n✗ Скрипт упал:', e)
  process.exit(1)
})
