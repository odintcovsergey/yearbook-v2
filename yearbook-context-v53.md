# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v53
# Обновлено: 12.05.2026 (после закрытия Фазы К)
#
# ⚠️ ВАЖНО: ПРЕЖДЕ ЧЕМ ПРИНИМАТЬСЯ ЗА ЛЮБУЮ ДРУГУЮ РАБОТУ — ПРОЧИТАЙ:
#   docs/roadmap-after-phase-3.md         — план фаз до боеготовности (обновлён 12.05.2026, фаза К закрыта)
#   docs/designer-questions-2026-05-10.md — вопросы дизайнеру + полученные ответы
#   docs/templates/master-cleanup-tz.md   — раздел F5 (виртуальные страницы)
#   yearbook-context-v52.md               — предыдущая версия контекста с полной историей фаз А/Б/В
#
# СТАТУС: АКТИВНЫЙ СЕЗОН (май 2026)
# Workflow производства готов. Партнёрский кабинет готов.
# Личный разворот реализован. CRM готов.
# Все фото в Yandex Object Storage.
# Цветокор/ретушь end-to-end работает (фаза К — 12.05.2026).
#
# СОСТОЯНИЕ ФАЗ 12.05.2026:
# ✓ А (А.1+А.2+А.3+А.4) ЗАКРЫТА — общий раздел + виньетки + UI (17 коммитов, 11.05.2026)
# ✓ Б минимум ЗАКРЫТА — оригиналы для печати (5 коммитов, 11.05.2026)
# ✓ В ЗАКРЫТА — cleanup + YC статистика виджет (3 коммита, 11.05.2026)
# ✓ К ЗАКРЫТА — workflow цветокора и ретуши (5 коммитов, 12.05.2026)
#
# 🎉 КРИТИЧЕСКИЕ БЛОКЕРЫ ЗАПУСКА ПАРТНЁРКИ ОСТАВШИЕСЯ:
#   - Фаза Г (печать в типографию) — ждёт ответы дизайнера (блок 1, 11)
#   - Фаза Е (обложка) — ждёт ответ дизайнера (15)
#   - Фаза Л (редактор макета MVP) — главная функциональная дыра, можно делать СЕЙЧАС
#
# ⚠️ ACTION ITEMS для Сергея после деплоя 12.05.2026:
#   1. Проверить что К.1-К.5 раскатились на проде после push'а 5 коммитов
#   2. Прогнать сценарий end-to-end на тестовом альбоме:
#        - вкладка Производство → 📥 Скачать оригиналы → распаковать ZIP
#        - убедиться что есть manifest.json + README.txt + подпапки по типам
#        - переименовать 1-2 файла для теста unmatched
#        - вернуть через 📤 Загрузить обработанные
#        - проверить summary блоки (🟢 Обновлено + 🟡 Не найдено)
#        - привязать unmatched через inline-autocomplete (К.5)
#        - проверить что PDF-экспорт берёт новые версии
#
# 🆕 ЧТО НОВОГО В v53 ОТНОСИТЕЛЬНО v52
#
# ────────────────────────────────────────────────────────────────────
# ФАЗА К — Workflow цветокора и ретуши (5 коммитов, 12.05.2026)
# ────────────────────────────────────────────────────────────────────
#
# Сценарий партнёра (теперь работает end-to-end):
#   1. Альбом готов → вкладка Производство → блок «Цветокор и ретушь»
#   2. Кнопка «📥 Скачать оригиналы» → ZIP с подпапками по типу
#   3. Ретушируем локально в Lightroom/Photoshop, имена не меняем
#   4. Кнопка «📤 Загрузить обработанные» (multiple file input)
#   5. Файлы напрямую в YC по presigned URL'ам (обход 4.5 МБ лимита)
#   6. Автоматический матчинг по filename → подмена original_path
#   7. Unmatched (если есть) привязываем вручную через inline autocomplete
#   8. PDF-экспорт автоматически использует новые оригиналы
#
# ────────────────────────────────────────────────────────────────────
# К.1 — backend GET /api/workflow/originals-zip (`0a8ebc6`)
# ────────────────────────────────────────────────────────────────────
#
# Файл: app/api/workflow/originals-zip/route.ts (316 строк)
#
# Параметры query:
#   album_id    — обязательный
#   view_as     — для сотрудников OkeyBook от имени партнёра (та же
#                 логика что в /api/tenant: superadmin || slug='main')
#   categories  — опциональный CSV-фильтр по 8 типам photos.type
#                 (portrait/group/teacher/common_*)
#
# Auth: ['owner', 'manager', 'viewer', 'superadmin']
# maxDuration: 60 сек
# MAX_PHOTOS: 200 (если больше → 413 + by_category для UI)
#
# Поведение:
#   - SELECT photos WHERE album_id=X AND original_path IS NOT NULL
#   - Опционально + WHERE type IN (categories)
#   - JOIN photo_children/photo_teachers для манифеста (привязки)
#   - Параллельное скачивание из YC батчами по 5
#   - При коллизии filename'ов → префикс <photo_id[:8]>_<filename>
#   - Подпапки в ZIP по типу: portrait/, group/, teacher/, common_*/
#   - manifest.json в корне (id, filename, type, zip_path,
#     attached_children, attached_teachers, failures)
#   - README.txt с инструкцией для ретушёра
#   - compression level=1 (фото уже сжаты)
#   - Заголовки: Content-Disposition с UTF-8 filename, X-Originals-*
#   - audit_log: workflow.download_originals_zip
#
# ────────────────────────────────────────────────────────────────────
# К.2 — UI «📥 Скачать оригиналы» в ProductionTab (`409d150`)
# ────────────────────────────────────────────────────────────────────
#
# Файл: app/app/page.tsx (ProductionTab на строке ~6574)
#
# Изменения:
#   - В сигнатуру ProductionTab добавлен viewAsTenantId?: string
#   - В AlbumDetailModal (вызов ProductionTab ~1962) пробрасывается
#     viewAsTenantId из props
#   - Новый блок «Цветокор и ретушь» (bg-blue-50/50) — над legacy
#     «Оригинальные фото», виден когда canEdit=true
#
# Логика handleDownloadOriginalsZip:
#   - fetch /api/workflow/originals-zip с view_as и categories
#   - При 200: blob() → URL.createObjectURL → <a download> click
#   - filename парсится из Content-Disposition (regex UTF-8'')
#   - Notification: «Скачано N оригиналов» + (если failures) «K не докачались»
#   - При 413: setBigAlbumOptions(response) → раскрывается панель
#     с чекбоксами категорий (русские лейблы Портреты/Групповые/
#     Учителя/Общий: на разворот/.../1/6 класса), сумма vs лимит,
#     кнопка «Скачать выбранные»
#
# ────────────────────────────────────────────────────────────────────
# К.3 — backend actions register/rebind/discard_retouched (`9c92729`)
# ────────────────────────────────────────────────────────────────────
#
# Файл: app/api/workflow/route.ts (+188 строк)
#
# register_retouched (главный):
#   Body: { album_id, files: [{ filename, storage_path }] }
#   - Все storage_path должны начинаться с yc:<album_id>/originals/
#     (защита от привязки произвольных путей)
#   - SELECT photos один раз с .in('filename', filenames)
#   - Маппинг filename → photo (первый при дублях)
#   - Для match: UPDATE photos.original_path + добавляем старый путь
#     в oldPathsToDelete
#   - Для no match: в unmatched
#   - После всех updates → параллельно ycDelete старых путей
#   - Response: { matched, unmatched_count, unmatched, replaced }
#   - audit_log: workflow.register_retouched
#
# rebind_retouched (К.5):
#   Body: { album_id, photo_id, storage_path }
#   - Проверка что photo принадлежит этому album_id
#   - UPDATE original_path + удаление старого
#
# discard_retouched (К.5):
#   Body: { album_id, storage_path }
#   - Проверка префикса yc:<album_id>/originals/
#   - ycDelete + audit_log
#
# ────────────────────────────────────────────────────────────────────
# К.4 — UI загрузки обработанных + summary (`ff05e60`)
# ────────────────────────────────────────────────────────────────────
#
# Файл: app/app/page.tsx (+198 строк в ProductionTab)
#
# State:
#   - uploadingRetouched, retouchedProgress {done,total}
#   - retouchedSummary { matched, unmatched_count, unmatched[], replaced[] }
#
# handleUploadRetouched(files):
#   Шаг 1: для каждого файла →
#     POST /api/upload-url с upload_type='originals'
#       (existing endpoint, кладёт в <album_id>/originals/<ts>_<cleanFilename>)
#     PUT файла в YC по полученному presigned URL
#     При fail отдельного файла — продолжаем с остальными
#   Шаг 2: POST /api/workflow action=register_retouched с массивом
#     { filename, storage_path }
#
# UI:
#   - Кнопка «📤 Загрузить обработанные» (input type=file multiple
#     accept=image/jpeg,image/png,image/tiff; value сброс после выбора)
#   - Прогресс-бар «Загружаем N/M…»
#   - Summary блоки:
#     🟢 green box «✅ Обновлено N оригиналов» + кнопка × скрыть
#     🟡 amber box «⚠️ Не найдено K файлов» + список с inline-привязкой (К.5)
#
# ────────────────────────────────────────────────────────────────────
# К.5 — inline-привязка unmatched (`d89f633`)
# ────────────────────────────────────────────────────────────────────
#
# Файл: app/app/page.tsx (+188 строк, -13 строк в ProductionTab)
#
# State:
#   - albumPhotos (lazy-loaded при первом focus)
#   - rebindSelections: Record<storage_path, filename> — выбор пользователя
#   - rebindingPaths: Set<storage_path> — индикация processing
#
# Lazy-load:
#   ensureAlbumPhotos() при первом focus на input привязки
#   → GET /api/tenant?action=album_photos (с view_as)
#   → setAlbumPhotos([{id, filename, type}])
#
# UI на каждый unmatched:
#   <input list="album-photos-<albumId>"> — нативный datalist autocomplete
#   <datalist> с options где value=filename и текст-метка по типу
#     (портрет|группа|учитель|общий)
#   Кнопка «Привязать» (disabled пока resolvePhotoIdByFilename()
#     не вернёт photo_id из value) → action=rebind_retouched
#   Кнопка 🗑 → action=discard_retouched (с confirm)
#   max-h-64 на списке unmatched, overflow-y-auto
#   После rebind/discard: убираем из unmatched, инкрементим matched
#
# ────────────────────────────────────────────────────────────────────
# ОГРАНИЧЕНИЯ И BACKLOG (фаза К)
# ────────────────────────────────────────────────────────────────────
#
# 1. view_as не работает в /api/upload-url и actions register/rebind/
#    discard_retouched в /api/workflow для не-superadmin. Это значит:
#    сотрудник OkeyBook через partner cabinet (не superadmin) не сможет
#    ЗАГРУЖАТЬ retouched от имени партнёра — только сам партнёр или
#    superadmin. Скачивание (К.1) работает с view_as.
#    Фикс: расширить /api/upload-url и workflow actions той же view_as
#    логикой что в /api/tenant. Не блокер для запуска партнёрки
#    (основной сценарий — партнёр сам грузит свои файлы).
#
# 2. Точечная замена одного оригинала (пункт 5 первоначальной спеки К)
#    отложена в Фазу Л.3 (редактор макета). Технически делается через
#    тот же /api/upload-url + rebind_retouched, но UX должен быть
#    в редакторе клик-на-фото → «Заменить оригинал».
#
# 3. Для альбомов >200 фото партнёр должен делать частичную выгрузку
#    по категориям. Если стрим ZIP'а станет требоваться (большие
#    альбомы) — отдельная задача К-расширение: streaming через
#    JSZip.generateNodeStream + Readable.toWeb.
#
# 4. UI К.5 использует нативный <datalist> — на mobile UX автокомплита
#    может быть кривой (зависит от браузера). Backlog: заменить
#    на кастомный модал с поиском и thumbnails если будут жалобы.
#
# ────────────────────────────────────────────────────────────────────
# КЛЮЧЕВЫЕ ФАЙЛЫ И МЕСТА
# ────────────────────────────────────────────────────────────────────
#
# Backend:
#   app/api/workflow/originals-zip/route.ts  — К.1 (новый файл)
#   app/api/workflow/route.ts                — К.3 (расширен POST handler)
#   app/api/upload-url/route.ts              — без изменений, использует
#                                              existing upload_type='originals'
#   app/api/tenant/route.ts                  — без изменений, action='album_photos'
#                                              используется в К.5 для lazy-load
#
# Frontend (всё в одном файле):
#   app/app/page.tsx
#     - AlbumDetailModal (~1962): передача viewAsTenantId в ProductionTab
#     - ProductionTab (~6574): весь UI фазы К — state, handlers, блок
#       «Цветокор и ретушь»
#
# Lib:
#   lib/storage.ts — без изменений, используется stripYcPrefix, ycDelete
#
# Схема БД:
#   photos.original_path — обновляется на новый путь после ретуши
#   Старые файлы удаляются из YC после успешной замены
#   Никаких новых таблиц/миграций для фазы К не требуется
#
# Audit log actions:
#   workflow.download_originals_zip — К.1
#   workflow.register_retouched     — К.3
#   workflow.rebind_retouched       — К.3
#   workflow.discard_retouched      — К.3
#
# ────────────────────────────────────────────────────────────────────
# КАНДИДАТЫ НА СЛЕДУЮЩУЮ РАБОТУ
# ────────────────────────────────────────────────────────────────────
#
# 🟡 Фаза Л — Редактор макета MVP (10-14 дней по оценке)
#   Главная оставшаяся функциональная дыра. Не зависит от ответов
#   дизайнера. План: Konva canvas (есть инфра из фазы 0.8 продукта B
#   для просмотра мастеров), редактирование album_layouts, текст,
#   замена фото, undo/redo. Подробности в roadmap-after-phase-3.md
#   секция «Фаза Л».
#   Л.3 будет включать точечную замену оригинала (отложено из К).
#
# ⏳ Когда придут ответы дизайнера:
#   - Фаза Г (печать в типографию) — блок 1, 11
#   - Фаза Е (обложка) — 15
#   - Фаза Д (размеры) — 17/18
#
# Опциональный backlog после фазы К:
#   - view_as поддержка в /api/upload-url и /api/workflow actions
#     register/rebind/discard_retouched
#   - Streaming ZIP для альбомов >200 фото
#   - Модал К.5 с поиском+thumbnails вместо нативного datalist
#
# ────────────────────────────────────────────────────────────────────
# 🔵 БИЛЛИНГ — БУДУЩАЯ ЗАДАЧА (без изменений с v52)
# ────────────────────────────────────────────────────────────────────
#
# Партнёры будут платить за сервис, но модель оплаты не определена.
# План: запуск партнёрки в июле начать с ручной оплаты, реальную
# инфраструктуру делаем когда наберётся 10+ партнёров и станет
# понятна модель. Подробности в v52.
#
# ────────────────────────────────────────────────────────────────────
# СВЯЗЬ С PDF-ЭКСПОРТОМ
# ────────────────────────────────────────────────────────────────────
#
# Layout не пересобирается после ретуши, потому что original_path
# обновляется in-place в таблице photos. При следующем экспорте PDF
# (фаза 3 продукта B) — новые версии используются автоматически.
# Никаких изменений в pdf-export не требуется.
