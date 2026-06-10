import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, isAuthError, logAction } from '@/lib/auth'
import { getPhotoSignedUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'
// ZIP может собираться долго при большом числе фото. Лимит 60 сек уже стоит
// в остальных workflow-роутах, придерживаемся.
export const maxDuration = 60

// Безопасный потолок на одну выгрузку. При среднем 5 МБ/файл — это ~1 ГБ
// исходных данных, что разумно умещается в 60 сек таймаута Vercel при
// скачивании из того же региона. Партнёр с большим альбомом использует
// фильтр ?categories=portrait,group для частичной выгрузки (К.2 предложит
// это в UI).
const MAX_PHOTOS = 200

const ALL_CATEGORIES = [
  'portrait',
  'group',
  'teacher',
  'common_spread',
  'common_full',
  'common_half',
  'common_quarter',
  'common_sixth',
  'common_collage',
] as const
type Category = (typeof ALL_CATEGORIES)[number]
const ALL_CATEGORIES_SET = new Set<string>(ALL_CATEGORIES)

// Имена внутри ZIP не должны содержать слешей и спецсимволов файловой
// системы. Кириллицу и пробелы оставляем (ZIP их понимает).
function safeZipName(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'file'
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ['owner', 'manager', 'viewer', 'superadmin'])
  if (isAuthError(auth)) return auth

  const albumId = req.nextUrl.searchParams.get('album_id')
  if (!albumId) {
    return NextResponse.json({ error: 'album_id required' }, { status: 400 })
  }

  // view_as: суперадмин и сотрудники главного тенанта могут скачивать
  // оригиналы от имени партнёра.
  const viewAsTenantId = req.nextUrl.searchParams.get('view_as')
  const { data: currentTenantData } = viewAsTenantId
    ? await supabaseAdmin.from('tenants').select('slug').eq('id', auth.tenantId).single()
    : { data: null }
  const canViewAs = auth.role === 'superadmin' || currentTenantData?.slug === 'main'
  const tid = canViewAs && viewAsTenantId ? viewAsTenantId : auth.tenantId

  // Опциональный фильтр по категориям. Игнорируем неизвестные значения.
  const categoriesParam = req.nextUrl.searchParams.get('categories')
  const requestedCategories: Category[] | null = categoriesParam
    ? (categoriesParam
        .split(',')
        .map((s) => s.trim())
        .filter((c) => ALL_CATEGORIES_SET.has(c)) as Category[])
    : null

  // Проверяем доступ к альбому.
  const albumQ = supabaseAdmin
    .from('albums')
    .select('id, title, tenant_id')
    .eq('id', albumId)
  if (auth.role !== 'superadmin') albumQ.eq('tenant_id', tid)
  const { data: album } = await albumQ.single()
  if (!album) {
    return NextResponse.json({ error: 'Альбом не найден' }, { status: 404 })
  }

  // По умолчанию выгружаем только выбранные родителями фото — не нужно
  // ретушировать всё подряд. include_unselected=1 позволяет фотографу
  // запросить полный архив (например, если хочет отретушировать заранее
  // до того как родители завершат выбор).
  //
  // Логика «выбранности» по типам:
  //   portrait → есть запись в selections (selection_type
  //              'portrait_page' или 'portrait_cover') ИЛИ
  //              в cover_selections.photo_id (когда cover_option='other')
  //   group    → есть запись в selections (selection_type='group')
  //   teacher  → нет селекта от родителей, выгружаем ВСЕ (фотограф/
  //              менеджер сам решает кого включать в альбом)
  //   common_* → нет селекта, выгружаем ВСЕ (общий раздел собирает
  //              фотограф)
  const includeUnselected = req.nextUrl.searchParams.get('include_unselected') === '1'

  // Собираем множество photo_id выбранных учениками этого альбома.
  // Делаем это только если фильтр включён И запрошены portrait/group
  // (иначе бессмысленно тянуть JOIN'ы).
  let selectedPhotoIds: Set<string> | null = null
  if (!includeUnselected) {
    const needPortrait =
      !requestedCategories || requestedCategories.includes('portrait')
    const needGroup =
      !requestedCategories || requestedCategories.includes('group')
    if (needPortrait || needGroup) {
      selectedPhotoIds = new Set<string>()

      // selections JOIN children → отфильтровать по album_id
      const types: string[] = []
      if (needPortrait) types.push('portrait_page', 'portrait_cover')
      if (needGroup) types.push('group')
      const { data: selRows } = await supabaseAdmin
        .from('selections')
        .select('photo_id, children!inner(album_id)')
        .eq('children.album_id', albumId)
        .in('selection_type', types)
      for (const r of (selRows ?? []) as any[]) {
        if (r.photo_id) selectedPhotoIds.add(r.photo_id)
      }

      // cover_selections — отдельная таблица для обложки «other»
      if (needPortrait) {
        const { data: covRows } = await supabaseAdmin
          .from('cover_selections')
          .select('photo_id, children!inner(album_id)')
          .eq('children.album_id', albumId)
          .eq('cover_option', 'other')
          .not('photo_id', 'is', null)
        for (const r of (covRows ?? []) as any[]) {
          if (r.photo_id) selectedPhotoIds.add(r.photo_id)
        }
      }
    }
  }

  // Берём только фото с оригиналом. Старые фото (до Б.1.0) и фото с
  // ошибочной загрузкой оригинала имеют original_path = NULL — их в этой
  // выгрузке нет.
  let photosQ = supabaseAdmin
    .from('photos')
    .select('id, filename, original_path, type, created_at')
    .eq('album_id', albumId)
    .not('original_path', 'is', null)
    .order('type')
    .order('created_at')
  if (requestedCategories && requestedCategories.length > 0) {
    photosQ = photosQ.in('type', requestedCategories)
  }
  const { data: photosRaw, error: photosErr } = await photosQ
  if (photosErr) {
    return NextResponse.json({ error: photosErr.message }, { status: 500 })
  }

  // Применяем фильтр выбранности на уровне JS (а не SQL) потому что
  // правила разные для разных type'ов. PostgREST не даёт удобно
  // выразить «portrait/group фильтровать по selections, остальные нет».
  type PhotoRow = { id: string; filename: string; original_path: string | null; type: string; created_at: string }
  const photos: PhotoRow[] = !selectedPhotoIds
    ? ((photosRaw ?? []) as PhotoRow[])
    : ((photosRaw ?? []) as PhotoRow[]).filter((p) => {
        if (p.type === 'portrait' || p.type === 'group') {
          return selectedPhotoIds!.has(p.id)
        }
        // teacher и common_* — пропускаем все
        return true
      })

  if (photos.length === 0) {
    // Считаем фото без original_path — это подсказка ретушёру что
    // оригиналы вообще не загружались (старый альбом до Б.1).
    const { count: totalCount } = await supabaseAdmin
      .from('photos')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', albumId)
    // Считаем фото которые есть, но не выбраны (для UX-подсказки).
    const filteredOutCount = (photosRaw ?? []).length - photos.length
    return NextResponse.json(
      {
        error: filteredOutCount > 0
          ? 'Нет выбранных учениками фото в этом альбоме'
          : 'Нет загруженных оригиналов в этом альбоме',
        hint:
          filteredOutCount > 0
            ? `Альбом содержит ${filteredOutCount} фото с оригиналами, но они ещё не выбраны учениками. Дождитесь завершения отбора или используйте «Включить невыбранные» для скачивания всех фото.`
            : totalCount && totalCount > 0
              ? 'Альбом содержит фото без сохранённых оригиналов (возможно загружены до фазы Б). Загрузите фото заново для получения оригиналов.'
              : 'Сначала загрузите фото в раздел Фото.',
        total_photos: totalCount ?? 0,
        filtered_out: filteredOutCount,
      },
      { status: 404 }
    )
  }

  if (photos.length > MAX_PHOTOS) {
    // Считаем по категориям чтобы партнёр в UI мог выбрать что скачать.
    const byCategory: Record<string, number> = {}
    for (const p of photos as any[]) {
      byCategory[p.type] = (byCategory[p.type] ?? 0) + 1
    }
    return NextResponse.json(
      {
        error: `Слишком много фото для одной выгрузки (${photos.length} > ${MAX_PHOTOS}).`,
        hint: 'Используйте параметр ?categories=portrait,group для частичной выгрузки.',
        total_count: photos.length,
        max_per_request: MAX_PHOTOS,
        by_category: byCategory,
      },
      { status: 413 }
    )
  }

  const photoIds = (photos as any[]).map((p) => p.id)

  // Связи с детьми/учителями — для манифеста. Это help для ретушёра
  // (видит «фото портрета Иванова Ивана») и для будущего матчинга в К.3.
  const [childrenLinks, teachersLinks] = await Promise.all([
    supabaseAdmin
      .from('photo_children')
      .select('photo_id, children(full_name)')
      .in('photo_id', photoIds),
    supabaseAdmin
      .from('photo_teachers')
      .select('photo_id, teachers(full_name)')
      .in('photo_id', photoIds),
  ])

  const childByPhoto = new Map<string, string[]>()
  for (const link of (childrenLinks.data ?? []) as any[]) {
    const name = link.children?.full_name
    if (!name) continue
    const arr = childByPhoto.get(link.photo_id) ?? []
    arr.push(name)
    childByPhoto.set(link.photo_id, arr)
  }
  const teacherByPhoto = new Map<string, string[]>()
  for (const link of (teachersLinks.data ?? []) as any[]) {
    const name = link.teachers?.full_name
    if (!name) continue
    const arr = teacherByPhoto.get(link.photo_id) ?? []
    arr.push(name)
    teacherByPhoto.set(link.photo_id, arr)
  }

  // Pre-compute путей внутри ZIP с обработкой коллизий filename'ов.
  // Один photo.filename может встречаться у нескольких photo (повторная
  // загрузка, разные категории и т.п.). При коллизии префиксуем имя
  // первыми 8 символами photo.id чтобы файлы не перезаписывали друг друга.
  const seenZipPaths = new Set<string>()
  const zipPathByPhoto = new Map<string, string>()
  for (const p of photos as any[]) {
    const safeFilename = safeZipName(p.filename)
    let zipPath = `${p.type}/${safeFilename}`
    if (seenZipPaths.has(zipPath)) {
      zipPath = `${p.type}/${String(p.id).slice(0, 8)}_${safeFilename}`
    }
    seenZipPaths.add(zipPath)
    zipPathByPhoto.set(p.id, zipPath)
  }

  // Бакет приватный, но прогонять сотни МБ оригиналов через serverless-
  // функцию нельзя (лимит времени/размера Vercel + кросс-облако до YC —
  // функция висит и обрывается). Поэтому функция отдаёт лишь СПИСОК signed-
  // ссылок, а архив собирает браузер: качает каждый оригинал напрямую из YC
  // и пакует на лету (см. handleDownloadOriginalsZip на клиенте). Генерация
  // ссылок — только HMAC, без сетевого трафика, мгновенно.
  const files = await Promise.all(
    (photos as any[])
      .filter((p) => p.original_path)
      .map(async (p) => ({
        id: p.id,
        filename: p.filename,
        type: p.type,
        zip_path: zipPathByPhoto.get(p.id)!,
        url: await getPhotoSignedUrl(p.original_path),
      }))
  )

  // Манифест — список всего, что войдёт в архив. Реальные ошибки скачивания
  // теперь на стороне браузера (он показывает, сколько файлов не докачалось).
  const manifest = {
    album_id: album.id,
    album_title: album.title,
    tenant_id: album.tenant_id,
    generated_at: new Date().toISOString(),
    generated_by: auth.userId,
    categories: (requestedCategories ?? ALL_CATEGORIES.slice()) as Category[],
    only_selected: !includeUnselected,
    total: files.length,
    photos: files.map((f) => ({
      id: f.id,
      filename: f.filename,
      type: f.type,
      zip_path: f.zip_path,
      attached_children: childByPhoto.get(f.id) ?? [],
      attached_teachers: teacherByPhoto.get(f.id) ?? [],
    })),
  }

  // README с короткой инструкцией для ретушёра — чтобы открывая ZIP
  // человек сразу понимал что куда. Дополнительно полезно если архив
  // пересылают между людьми.
  const readme = [
    `Альбом: ${album.title}`,
    `Сгенерирован: ${manifest.generated_at}`,
    `Файлов в архиве: ${files.length}`,
    includeUnselected
      ? 'Режим: ВСЕ загруженные оригиналы (включая невыбранные)'
      : 'Режим: только выбранные родителями + все учителя и общий раздел',
    '',
    '════════════════════════════════════════════════════════════',
    'СТРУКТУРА АРХИВА',
    '════════════════════════════════════════════════════════════',
    '',
    '  manifest.json    — метаданные альбома (нужен системе, не удалять)',
    '  portrait/        — портреты учеников',
    '  group/           — групповые фото для личных страниц',
    '  teacher/         — фото учителей',
    '  common_*/        — фото общего раздела (на разворот, полные, ...)',
    '',
    '════════════════════════════════════════════════════════════',
    'РЕТУШЬ В ADOBE LIGHTROOM CLASSIC',
    '════════════════════════════════════════════════════════════',
    '',
    'ИМПОРТ:',
    '  1. Распакуйте архив в любую папку.',
    '  2. В Lightroom: File → Import Photos and Video... (⌘⇧I / Ctrl+Shift+I)',
    '  3. Слева выберите распакованную папку. Включите «Include Subfolders»',
    '     чтобы Lightroom подхватил все подпапки (portrait/, group/, ...).',
    '  4. Сверху выберите режим «Add» — фото остаются на месте,',
    '     Lightroom только индексирует их (быстрее и не занимает место).',
    '  5. Нажмите Import.',
    '',
    'РЕТУШЬ:',
    '  Работайте в модуле Develop как обычно. Применяйте пресеты,',
    '  кисти, цветокор. При желании скопируйте настройки на партию',
    '  кадров: ПКМ на фото → Develop Settings → Copy Settings →',
    '  выделите остальные → Paste Settings.',
    '',
    'ЭКСПОРТ (КРИТИЧНО — СОХРАНИТЕ ИМЕНА!):',
    '  1. Выделите все обработанные фото (⌘A / Ctrl+A).',
    '  2. File → Export... (⌘⇧E / Ctrl+Shift+E)',
    '  3. Export Location: выберите ЛЮБУЮ новую папку. Подпапки можно',
    '     не сохранять — система найдёт фото по имени.',
    '  4. File Naming: ОБЯЗАТЕЛЬНО снимите галочку «Rename To»',
    '     (или выберите шаблон «Filename» без модификаций).',
    '     Если имена изменятся — система не найдёт фото для подмены.',
    '  5. File Settings: JPEG, Quality 90-100, Color Space sRGB.',
    '  6. Image Sizing: «Do not resize» (для печати нужно полное',
    '     разрешение, ресайз сделает наша система).',
    '  7. Output Sharpening: Screen (Standard) или выключить.',
    '  8. Export.',
    '',
    '════════════════════════════════════════════════════════════',
    'ВОЗВРАТ В СИСТЕМУ',
    '════════════════════════════════════════════════════════════',
    '',
    '  1. Откройте альбом → вкладка «Производство»',
    '  2. Кнопка «Загрузить обработанные» в блоке «Цветокор и ретушь»',
    '  3. Выберите все экспортированные файлы из одной папки.',
    '  4. Система сопоставит файлы с оригиналами по имени.',
    '     Совпавшие — заменят оригиналы (PDF-экспорт автоматически',
    '     возьмёт новые версии).',
    '     Не нашлись — будут показаны для ручной привязки.',
    '',
    'ЕСЛИ ИМЯ ИЗМЕНИЛОСЬ:',
    '  В UI после загрузки появится список «Не найдено N файлов».',
    '  Для каждого можно начать вводить оригинальное имя — система',
    '  подскажет из автокомплита. Кнопка «Привязать» подменит',
    '  оригинал на новую версию.',
  ].join('\n')

  await logAction(auth, 'workflow.download_originals_zip', 'album', albumId, {
    requested: files.length,
    categories: requestedCategories ?? null,
    only_selected: !includeUnselected,
  })

  const safeTitle = (album.title || 'альбом').replace(
    /[^a-zA-Z0-9а-яА-ЯёЁ]/g,
    '_'
  )
  const filename = `оригиналы_${safeTitle}.zip`

  // Отдаём список ссылок + тексты manifest/README. Архив собирает браузер
  // (потоково, из прямых YC-ссылок) — см. client-zip на клиенте.
  return NextResponse.json({
    filename,
    total: files.length,
    files,
    manifest,
    readme,
  })
}
