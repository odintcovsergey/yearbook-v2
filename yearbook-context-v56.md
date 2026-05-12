# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v56
# Обновлено: 12.05.2026 (вечер — фазы М, техдолг #4/#5, UX-фиксы загрузки)
#
# ⚠️ ВАЖНО: ПРЕЖДЕ ЧЕМ ПРИНИМАТЬСЯ ЗА ЛЮБУЮ ДРУГУЮ РАБОТУ — ПРОЧИТАЙ:
#   docs/phase-l-spec.md                  — спецификация фазы Л v2 (✅ ЗАКРЫТА)
#   docs/roadmap-after-phase-3.md         — план фаз до боеготовности
#   docs/designer-questions-2026-05-10.md — вопросы дизайнеру + ответы
#   docs/templates/master-cleanup-tz.md   — раздел F5 (виртуальные страницы)
#   yearbook-context-v55.md               — фазы Л + П детально
#   yearbook-context-v54.md               — фаза К детально
#   yearbook-context-v53.md, v52.md       — история фаз А/Б/В/К
#
# СТАТУС: АКТИВНЫЙ СЕЗОН (май 2026)
# Workflow производства готов. Партнёрский кабинет готов.
# Личный разворот реализован. CRM готов.
# Все фото в Yandex Object Storage.
# Цветокор/ретушь end-to-end работает в проде (фаза К — 12.05.2026).
# CORS на YC bucket настроен (исправлен критический баг Б.1.3).
# Редактор макета готов (фаза Л — 12.05.2026).
# Структурное редактирование макета готово (фаза М — 12.05.2026, вечер).
#
# СОСТОЯНИЕ ФАЗ 12.05.2026:
# ✓ А (А.1+А.2+А.3+А.4) — общий раздел + виньетки + UI (17 коммитов, 11.05.2026)
# ✓ Б минимум — оригиналы для печати (5 коммитов, 11.05.2026)
# ✓ В — cleanup + YC статистика виджет (3 коммита, 11.05.2026)
# ✓ К — workflow цветокора и ретуши (5 коммитов К.1-К.5 + К.7, 12.05.2026)
# ✓ П — UX загрузки оригиналов (1 коммит, 12.05.2026)
# ✓ Л — редактор макета (10 коммитов Л.0-Л.5 + 3 swap-фикса, 12.05.2026)
# ✓ М — структурное редактирование (3 коммита М.1-М.3, 12.05.2026 вечер)
# ✓ Техдолг #4 + #5 + bulk-догрузка + UX-фиксы (5 коммитов, 12.05.2026 вечер)
#
# 🎉 КРИТИЧЕСКИЕ БЛОКЕРЫ ЗАПУСКА ПАРТНЁРКИ ОСТАВШИЕСЯ:
#   - Фаза Г (печать в типографию) — ждёт ответы дизайнера (блок 1, 11)
#   - Фаза Е (обложка) — ждёт ответ дизайнера (15)
#   - Все остальные фазы (Л + М основная функциональность) — ЗАКРЫТЫ
#
# 💰 БИЛЛИНГ YANDEX CLOUD:
# Free tier YC = 1 ГБ хранения. На 12.05 occupancy ~997 МБ — у грани.
# Сергей оплачивает YC сегодня вечером. После оплаты — биллинг по факту,
# ~2 ₽/ГБ/мес. При 100 альбомах/мес ~300 ₽/мес за хранилище.
# КРИТИЧНО: если YC quota переполнится — register_original фейлится
# тихо, фото без оригинала идёт в PDF в WebP-качестве. У Сергея 12.05
# вечером это уже случилось с 17 файлами (исправлено через bulk-догрузку
# после пополнения).
#
# 🆕 ЧТО НОВОГО В v56 ОТНОСИТЕЛЬНО v55
#
# ────────────────────────────────────────────────────────────────────
# 🔧 ТЕХДОЛГ — UNSUBMIT WORKFLOW + GLOBAL ORIGINALS INDICATOR
# ────────────────────────────────────────────────────────────────────
#
# Техдолг#5 — endpoint unsubmit + кнопка «Снять с работы» (a94dad0):
#   - POST /api/workflow action=unsubmit
#   - submitted → ready: партнёр (owner) или OkeyBook (superadmin)
#   - in_production → submitted: только superadmin/OkeyBook
#     (партнёру 403 'Свяжитесь с OkeyBook')
#   - delivered → in_production: НЕ через action, только SQL
#   - Audit workflow.unsubmit с meta {from, to}
#   - Frontend ProductionTab: кнопки «↩ Отменить передачу»
#     (submitted) / «↩ Снять с работы» (in_production, оранжевая,
#     только superadmin/OkeyBook)
#   - Партнёр при in_production видит баннер 'Свяжитесь с OkeyBook'
#
# Техдолг#4 — Lift originalsProgress в AppPage + глобальный индикатор
# (7253e25):
#   - State originalsProgress поднят из PhotosTab в AppPage
#   - beforeunload protection теперь работает ДАЖЕ когда модал
#     альбома закрыт (раньше state'у в unmounted PhotoTab cleanup
#     удалял handler)
#   - Глобальный индикатор в header'е кабинета рядом с «Выйти»:
#     blue '📤 Оригиналы: N/M' / amber '⚠ Оригиналы: N/M' / green
#     '✓ Оригиналы загружены' с кнопкой ✕ скрыть
#   - PhotosTab принимает state через props
#   - AlbumDetailModal и PartnersDashboardModal пробрасывают
#
# Техдолг#4-bulk — массовая догрузка оригиналов (893b809):
#   Use cases: catastrophic fail YC (как было у Сергея с 17 файлами) /
#   бэкфилл оригиналов старых альбомов.
#   - Кнопка «📤 Догрузить оригиналы» в header'е галереи PhotoTab,
#     видна только когда photos.some(!has_original), disabled пока
#     идёт другая загрузка
#   - File picker multiple, матчинг по filename case-insensitive
#   - Confirm с превью первых 5 несовпавших файлов
#   - Параллельная загрузка CONCURRENCY=5 через тот же pipeline
#     (presigned URL + PUT + register_original)
#   - Прогресс через global originalsProgress state
#   - amber-счётчик 'N фото · K без оригинала' в header'е галереи
#
# ────────────────────────────────────────────────────────────────────
# 🎨 UX-ФИКСЫ — ПРОГРЕСС ЗАГРУЗКИ ОРИГИНАЛОВ
# ────────────────────────────────────────────────────────────────────
#
# UX#1 — прогресс наверх + акцент на оригиналах (47ba4ad):
# Сергей жаловался: блок с оригиналами был ВНИЗУ, кнопка показывала
# прогресс WebP (быстрая фаза), главное было скрыто.
#   - Блок прогресса перенесён НАВЕРХ загрузочного блока (между
#     заголовком 'Загрузка фотографий' и файловыми инпутами)
#   - Дизайн громче: border-2, большая цифра '3 / 17' справа (text-2xl
#     tabular-nums), МБ счётчик, прогресс-бар h-3 толще, animate-pulse
#   - Главная кнопка 'Загрузить все' теперь отражает ОБА фазы:
#     'Подготовка превью... (X/N)' → 'Идёт загрузка оригиналов (X/N)'
#   - Кнопка disabled пока ЛЮБАЯ фаза активна (предотвращает 'двойную
#     загрузку' с пересечением сессий)
#   - Описание блока: 'Сначала загрузятся превью (быстро), затем —
#     оригиналы для печати (дольше).'
#
# UX#2 — live indicator inProgress (29db542):
# Сергей: 'после WebP=100% оригинал-счётчик 0/N и кажется что зависло'.
# Реально между push'ем в originalPromises и началом fetch'а есть пауза
# из-за CPU-bottleneck (WebP compression в workers).
#   - Новый callback onOriginalStarted(filename) в uploadFilesParallel
#     — вызывается ДО первого fetch'a внутри uploadOriginalBackground
#   - State originalsProgress +поле inProgress: number
#     onOriginalStarted → inProgress++
#     onOriginalProgress → inProgress-- + done++
#   - UI блок прогресса показывает динамический подзаголовок:
#     inProgress > 0: '⏳ В работе сейчас: K'
#     done = 0 && inProgress = 0: 'Подготовка к загрузке…'
#     done > 0: стандартный текст
#   - Глобальный индикатор: 'Оригиналы: 3/18 (⏳5)'
#   - Bulk handler тоже tracking inProgress
#
# ПСИХОЛОГИЧЕСКИЙ ФИКС: реальный network throughput не изменился,
# просто партнёр видит 'идёт' даже когда done не двигается.
#
# ────────────────────────────────────────────────────────────────────
# 🏗 ФАЗА М — СТРУКТУРНОЕ РЕДАКТИРОВАНИЕ МАКЕТА (3 коммита)
# ────────────────────────────────────────────────────────────────────
#
# Партнёр теперь может полностью редактировать структуру макета:
# переупорядочивать, добавлять, удалять, заменять шаблон разворота.
#
# 🔵 М.1 — Strip миниатюр с drag-to-reorder (7ff7329):
#   Новый компонент app/app/_components/SpreadOrderStrip.tsx:
#   - Горизонтальная полоса миниатюр всех разворотов внизу редактора
#   - @dnd-kit/sortable с horizontalListSortingStrategy
#   - Каждая миниатюра — компактный AlbumSpreadCanvas (96px) в preview
#   - Номер разворота в углу, активный — синяя рамка + ring
#   - Клик → onSelect(idx) переход к развороту
#   - Drag → arrayMove + реномерация spread_index у ВСЕХ разворотов
#     (backend полагается на это при render'е PDF и пересборке)
#   - Сохранение активного разворота при перестановке
#   - В read-only — только клик-навигация
#
# 🔵 М.2 — Добавить / удалить разворот (c21c3db):
#   Новый компонент app/app/_components/TemplatePickerModal.tsx:
#   - Модал выбора шаблона из template_set
#   - Группировка по page_role (Портреты / Сетка / Учителя / Общий
#     раздел / Заглавный) с RU-метками
#   - Поиск по name + audit_notes
#   - Превью каждого шаблона через AlbumSpreadCanvas с data={} (структура
#     placeholder'ов)
#   - Esc / клик-вне закрывают, autoFocus на поиске
#   - Бейдж 'fallback' для is_fallback шаблонов
#   - Адаптивная сетка превью (2/3/4 колонки)
#
#   SpreadOrderStrip расширен:
#   - Кнопка '✕' в углу каждой миниатюры (hover), confirm-диалог,
#     skip последнего разворота (нельзя удалить единственный)
#   - Кнопка '➕ Добавить' в конце strip — открывает picker
#   - Структура thumb переделана: drag listeners только на внутреннем
#     div'е с контентом, кнопка ✕ снаружи (stopPropagation от drag)
#
#   Handlers в LayoutEditorPage:
#   - handleDeleteSpread(idx): confirm + filter + реномерация
#   - handleAddRequest(insertAfterIdx) → setAddAfterIdx (открывает модал)
#   - handleAddSpread(template): создаёт SpreadInstance с data={}, вставляет
#     после addAfterIdx + реномерация, переход на новый
#
# 🔵 М.3 — Замена шаблона разворота (b82b6de):
#   Используется тот же TemplatePickerModal с другим заголовком.
#   - Кнопка '🔄 Заменить шаблон' в навигации под canvas'ом
#     (рядом с ◀ Назад / Вперёд ▶ через ml-auto справа)
#   - title-tooltip показывает имя текущего шаблона
#   - Скрыта в read-only
#
#   handleReplaceTemplate:
#   - Mapping старых data в новые placeholder'ы по совпадению label
#   - Подсчёт preserved и lost
#   - Если lost > 0 — confirm 'Перенесено X, потеряется Y. Ctrl+Z отменит.'
#   - Если lost == 0 — замена без вопросов
#
#   Хорошо работает для свопов внутри одной page_role (E-Student-Standard
#   → E-Student-Quote на 80-90% labels пересекаются), плохо для крестных
#   (Portrait → Common почти все потеряются), но партнёр видит цифры
#   до подтверждения.
#
# Все три (М.1+М.2+М.3) — изменения spreads попадают в Л.3 history,
# Ctrl+Z откатывает каждую операцию.
#
# Что НЕ вошло в М (отложено):
# - Touch events для мобильного drag (мобильный остаётся read-only из Л.4a)
# - Виртуализация PhotoPalette для альбомов 1000+ фото (не упёрлись)
# - 'Умные' предложения шаблонов (показать только page_role совпадающие)
#
# ────────────────────────────────────────────────────────────────────
# ⚠️ ИЗВЕСТНЫЕ БАГИ / ОТЛОЖЕННЫЕ ВОПРОСЫ
# ────────────────────────────────────────────────────────────────────
#
# - Л.4a (read-only режим) — Сергей сказал что не понимает реальной
#   пользы. Возможно потребуется пересмотр (убрать mobile/view_as,
#   оставить только submitted). Зафиксировано в backlog.
#
# - beforeunload protection при закрытом модале — РЕШЕНО техдолг#4
#   (lift state в AppPage + глобальный индикатор).
#
# - Endpoint unsubmit — РЕШЁН техдолг#5.
#
# - YC quota — Сергей оплачивает 12.05 вечером, после чего проблемы
#   с register_original должны исчезнуть. Виджет хранилища в /super
#   показывает occupancy.
#
# - Старые альбомы до 11.05 (CORS-фикс) могут иметь photos с
#   original_path=NULL. РЕШЕНИЕ: bulk-кнопка «📤 Догрузить оригиналы»
#   в PhotoTab — выбрать папку с оригиналами, система найдёт по имени.
#
# ────────────────────────────────────────────────────────────────────
# 🛠 КЛЮЧЕВЫЕ ФАЙЛЫ (обновлены или новые в v56)
# ────────────────────────────────────────────────────────────────────
#
# Новые компоненты:
# - app/app/_components/SpreadOrderStrip.tsx (~230 строк)
#   М.1 drag-to-reorder + М.2 кнопки add/delete
# - app/app/_components/TemplatePickerModal.tsx (~200 строк)
#   М.2/М.3 модал выбора шаблона
#
# Обновлённые:
# - app/app/album/[id]/layout/page.tsx (~1300 строк) — все М handlers
# - app/app/page.tsx (~8600 строк) — lift originalsProgress, UX блок
#   прогресса, bulk-handler, кнопки догрузки
# - app/api/workflow/route.ts — action=unsubmit
#
# Endpoints (полный список используемых редактором/PhotoTab):
# - /api/layout?action=album_layout — load (возвращает can_edit/workflow_status)
# - /api/layout?action=save_album_layout — save (read-only protection)
# - /api/tenant?action=photos / album_photos — has_original в response
# - /api/tenant?action=register_original — bulk и одиночная догрузка
# - /api/upload — multipart WebP upload + register_photo
# - /api/upload-url — presigned URL для оригиналов (минует Vercel 4.5МБ)
# - /api/workflow?action=submit_to_okeybook / take_in_production /
#   mark_delivered / unsubmit / rebind_retouched
#
# ────────────────────────────────────────────────────────────────────
# СЛЕДУЮЩИЕ ШАГИ (после фазы М)
# ────────────────────────────────────────────────────────────────────
#
# ВАРИАНТЫ ВЫБОРА:
#
# 1. Тестирование полного цикла с реальным альбомом (РЕКОМЕНДУЕТСЯ)
#    — после оплаты YC прогнать создание → загрузка фото с оригиналами
#    → отбор учеников → редактирование макета (drag/text/М.1-М.3) →
#    передача в OkeyBook → ретушь → delivery. Найти что ещё цепляет
#    прежде чем браться за большие фазы.
#
# 2. Бэкфилл оригиналов старых альбомов — у фото созданных до
#    11.05.2026 (фикс CORS) original_path=NULL. Bulk-кнопка
#    «📤 Догрузить оригиналы» уже работает (техдолг#4-bulk),
#    но партнёру нужны исходники на компе. Возможна автоматизация
#    через /super: SQL-отчёт «N альбомов с K фото без оригиналов».
#
# 3. Фазы Г/Е/Д (печать в типографию, обложка, размеры) — ждут
#    ответы дизайнера. Если ответы пришли — можно начинать.
#
# 4. Расширения фазы П (П.4-П.7):
#    - П.4 Audit log photo.original_upload_failed
#    - П.5 Persistent queue в localStorage (resilience)
#    - П.6 Retry с exponential backoff
#    - П.7 (уже реализовано как техдолг#4-bulk)
#
# 5. Расширения фазы М (отложены):
#    - Touch events для мобильного drag (потребует снятия Л.4a mobile)
#    - 'Умные' предложения шаблонов в TemplatePickerModal
#    - Виртуализация PhotoPalette
#
# 6. Пересмотр Л.4a (Сергей не понимает пользы read-only режима)
#    — возможно убрать mobile/view_as защиту, оставить только submitted.
#
# 🆕 ЧТО НОВОГО В v55 ОТНОСИТЕЛЬНО v54
#
# ────────────────────────────────────────────────────────────────────
# 🎨 ФАЗА Л — РЕДАКТОР МАКЕТА (полностью закрыта, 10 коммитов)
# ────────────────────────────────────────────────────────────────────
#
# Изначально планировался «с нуля», но при старте обнаружено что
# фаза 2 продукта B (Canvas-редактор) уже сделана 09.05.2026. Спека
# переписана как «доделка существующего».
#
# Что было в проде до Л:
#   - /app/album/[id]/layout — рабочий редактор с Konva canvas
#   - Drag фото из палитры в placeholder + swap photo↔photo
#   - Auto-save с debounce 2 сек + SaveIndicator + beforeunload
#   - LayoutPreviewStrip в Обзоре альбома с кнопкой «Открыть редактор»
#   - confirm-диалог при пересборке если has_user_edits=true
#
# Что добавлено в Л:
#
# 🔵 SWAP-OVERLAY ФИКС (3 итерации):
#   При swap фото в редакторе drag-preview «оторван» от точки клика.
#   Первые 2 попытки через @dnd-kit DragOverlay не сработали —
#   позиционирование portal'ом ломалось в нашем layout.
#   Финальный фикс (b6c78a8): CSS transform на source-элементе,
#   DragOverlay для swap НЕ используется. AlbumSpreadCanvas получает
#   prop `draggingLabel` — скрывает Konva-копию во время drag,
#   DropZone сам рендерит img-preview с inline transform: translate(X,Y).
#
# 🔵 Л.1 — РЕДАКТИРОВАНИЕ ТЕКСТА (f507974):
#   - TextDropZone в AlbumSpreadCanvas — прозрачный div с cursor:text,
#     hover ring, отдельная подсветка для пустых слотов
#   - TextInlineEditor — textarea точно поверх Konva-текста с теми
#     же стилями: fontFamily, fontSize (pt→px через PT_TO_MM*scale),
#     color (с isTooLight fallback), textAlign, lineHeight:1
#   - Enter подтверждает, Shift+Enter перенос, Esc отменяет,
#     Blur — soft submit
#   - Пустая строка → null (слот пустой)
#   - editingTextLabel prop скрывает Konva TextSlot во время edit
#
# 🔵 Л.2 + Л.2+ — КОНТЕКСТНОЕ МЕНЮ ФОТО (bc14e9c, 6420ebe, 4ea293f):
#   Правый клик на photo placeholder → popover с 3 действиями:
#   - 🗑 Очистить слот
#   - 📷 Загрузить другое фото (happy-path: WebP+оригинал, ставит
#     в слот, добавляет в палитру)
#   - 🎨 Подменить только оригинал (продвинутое — для доретуши
#     после согласования макета)
#   PhotoContextMenu позиционирует popover по clientX/clientY с
#   auto-correction, закрывается mousedown/Esc.
#
# 🔵 Л.3 — UNDO/REDO (53dc4a6):
#   - State { past: SpreadInstance[][], future: SpreadInstance[][] }
#     с лимитом 50 шагов, JSON.stringify deep-equal для no-op
#   - useEffect с prevSpreadsRef + skipNextHistoryRef для tracking
#   - Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo, Cmd/Ctrl+S force-save
#   - Поддержка русской раскладки (я/Я, ы/Ы)
#   - Игнорируется в input/textarea/contentEditable
#   - Кнопки «↶ Отменить (N)» / «↷ Повторить (N)» в header с детектом
#     Mac через navigator.platform для правильного title
#
# 🔵 Л.4a — READ-ONLY РЕЖИМ (e5366ee):
#   Backend (handleGetAlbumLayout):
#   - Параллельно с layout загружаем album.workflow_status
#   - Вычисляем can_edit + edit_block_reason:
#     superadmin → true (для исправлений)
#     viewer → false (reason='role')
#     view_as → false (reason='view_as')
#     submitted/in_production/delivered → false (reason='submitted')
#   - Response расширен полями workflow_status, can_edit, edit_block_reason
#   Backend (handleSaveAlbumLayout):
#   - Зеркалирует логику: 403 для viewer/view_as/submitted (кроме superadmin)
#   Frontend:
#   - Импорт useSearchParams + Suspense (Next 14 требует Suspense boundary)
#   - State canEdit, editBlockReason, workflowStatus, isMobile
#   - useEffect с window.matchMedia('(max-width: 767px)')
#   - isReadOnly = !canEdit || isMobile
#   - Auto-save / handleDragStart/End / keyboard handler — early return
#     если isReadOnly
#   - AlbumSpreadCanvas mode=preview, все handlers undefined
#   - PhotoPalette скрыта в read-only, баннер вместо неё
#   - Header бейдж режима (orange/blue/gray) с tooltip
#
#   ⚠️ Л.4a — РЕШЕНО ПРОДОЛЖАТЬ КАК ЕСТЬ, но Сергей высказал что
#   не понимает реальной пользы. В будущей сессии может потребоваться
#   пересмотр: убрать mobile view-only (неочевидная польза), оставить
#   только submitted-защиту. Зафиксировано в backlog.
#
# 🔵 Л.5 — ONBOARDING + СТРЕЛКИ НАВИГАЦИИ (6f89617):
#   - Modal при первом открытии редактора (localStorage флаг
#     'yearbook_layout_editor_seen'), 5 подсказок (drag, текст,
#     undo, стрелки, autosave), Esc/click-out/Enter закрывают
#   - Стрелки ← / → переключают развороты (в отдельном useEffect,
#     работает и в read-only). Игнорируется в input/textarea и
#     при зажатых модификаторах (Ctrl+← это back в браузере)
#
# Что НЕ вошло в Л (отложено):
#   - Л.4b бейдж «✏️ Редактировался» в карточке Обзора (не критично)
#   - Keyboard shortcuts modal (?) — партнёры шорткатами не пользуются
#   - Audit log на photo/text edit actions (save_album_layout уже
#     пишет общее событие)
#   - Перетаскивание разворотов, замена шаблона, версии в БД,
#     touch events, виртуализация палитры — фаза М
#
# ────────────────────────────────────────────────────────────────────
# 📤 ФАЗА П — UX ЗАГРУЗКИ ОРИГИНАЛОВ (583d787)
# ────────────────────────────────────────────────────────────────────
#
# Критическая проблема обнаружена при тестировании Л.2: WebP грузится
# быстро (≤30 сек), UI показывает «готово», но оригиналы (5-10 МБ
# каждый, ~1.4 ГБ на альбом 200 фото) продолжают грузиться 10-40 минут
# в фоне БЕЗ индикации. Партнёр закрывает вкладку → оригиналы
# не докачиваются → PDF в WebP-качестве (не для типографии).
#
# Без П партнёрка нежизнеспособна: первая массовая загрузка → fail.
#
# Реализовано одним коммитом (П.1 + П.2 + П.3):
#
# П.1 — uploadFilesParallel принимает callbacks:
#   - onOriginalsStart(total, totalBytes) — один раз при старте
#   - onOriginalProgress(filename, bytes, ok) — для каждого
#   - onOriginalsAllDone() — после Promise.all всех фоновых
#   - originalPromises[] — собираем чтобы дождаться завершения
# PhotoTab state originalsProgress (total/done/failed/totalBytes/
# doneBytes/failedFilenames/completed), мерджит multiple сессии.
# UI прогресс-бар между «Загрузить все» и галереей: 3 состояния
# (загрузка blue / завершено-успешно green / с ошибками amber),
# счётчик файлов и МБ, details со списком упавших файлов.
#
# П.2 — beforeunload protection в PhotoTab пока originalsProgress &&
# !completed. Браузер показывает дефолтное «Сайт хочет закрыть...».
#
# П.3 — has_original boolean в /api/tenant?action=photos response.
# В photo grid (галерея): amber бейджик «⚠ нет оригинала» в углу,
# при hover — кнопка «📤 Догрузить оригинал» внизу. Handler делает
# полный pipeline (presigned URL + PUT + register_original).
#
# ⚠️ ИЗВЕСТНЫЙ БАГ (отложен в backlog):
# beforeunload protection не работает при закрытом модале альбома
# — state в unmounted PhotoTab. Сергей проверил на практике, fetch'и
# продолжают работать в фоне и реально догружаются. Для надёжности
# нужен lift state в AppPage + глобальный индикатор в header кабинета.
# Решено отложить, если столкнёмся с реальными потерями — вернёмся.
#
# ────────────────────────────────────────────────────────────────────
# ЧТО В РАБОЧЕМ КАТАЛОГЕ (для следующей сессии)
# ────────────────────────────────────────────────────────────────────
#
# Ключевые файлы фазы Л:
#
# - app/app/album/[id]/layout/page.tsx (~1100 строк)
#   Главный редактор. LayoutEditorPage = Suspense wrapper,
#   LayoutEditorPageInner = вся логика.
#
# - app/app/_components/AlbumSpreadCanvas.tsx (~580 строк)
#   Konva рендер. Props: instance, template, containerWidth, mode,
#   draggingLabel, editingTextLabel, onTextClick, onTextSubmit,
#   onTextCancel, onPhotoContextMenu.
#
# - app/app/_components/PhotoPalette.tsx — палитра справа, поиск/фильтр
#
# - app/app/_components/PhotoContextMenu.tsx — popover, 3 действия
#
# - app/app/_components/SaveIndicator.tsx — статус сохранения
#
# - app/api/layout/route.ts:
#   * handleGetAlbumLayout (~815) — возвращает can_edit/workflow_status
#   * handleSaveAlbumLayout (~726) — серверная read-only защита
#
# - app/api/tenant/route.ts:
#   * action=photos (~498) — has_original в response
#   * action=album_photos (~562) — has_original в response
#   * action=register_photo (~2211)
#   * action=delete_photos_by_type (~2240)
#
# - app/api/workflow/route.ts:
#   * action=rebind_retouched (~451) — для замены оригинала
#
# - app/app/page.tsx (~8100 строк):
#   * Photo type +has_original
#   * uploadFilesParallel +callbacks
#   * PhotoTab +originalsProgress state +UI +beforeunload
#   * uploadOriginalForPhoto handler (П.3)
#
# Миграции применены (12.05):
# - album-layouts-editor-migration.sql (edited_at/edited_by/
#   rebuild_warnings nullable, не используются ни одним endpoint'ом
#   на момент v55, могут пригодиться в Л.4b)
#
# CORS на YC bucket настроен 11.05 (4 origins: vercel.app,
# album.okeybook.ru, okeybook.ru, localhost:3000).
#
# ────────────────────────────────────────────────────────────────────
# СЛЕДУЮЩИЕ ШАГИ (после Л)
# ────────────────────────────────────────────────────────────────────
#
# ВАРИАНТЫ ВЫБОРА:
#
# 1. Тестирование редактора с реальным альбомом (рекомендуется
#    перед следующими большими фазами).
#
# 2. Бэкфилл оригиналов для старых альбомов — у фото созданных до
#    11.05.2026 (фикс CORS) original_path = NULL. Сейчас можно
#    догружать через UI (П.3 кнопка), но массовый бэкфилл удобнее
#    сделать одной командой. SQL скрипт + UI инструмент в /super.
#
# 3. Фазы Г/Е/Д (печать в типографию, обложка, размеры) — ждут ответы
#    дизайнера. Если ответы пришли — можно начинать.
#
# 4. Расширения фазы П (П.4-П.7):
#    - П.4 Audit log photo.original_upload_failed
#    - П.5 Persistent queue в localStorage (resilience)
#    - П.6 Retry с exponential backoff
#    - П.7 Массовая догрузка оригиналов из папки (recovery)
#
# 5. Фаза М (расширения редактора): перетаскивание разворотов,
#    замена шаблона, добавление/удаление, touch events.
#
# 6. Lift originalsProgress в AppPage + глобальный индикатор
#    (мелкий фикс под фазу П).
#
# ────────────────────────────────────────────────────────────────────
# 🐛 КРИТИЧЕСКИЙ БАГ Б.1.3 НАЙДЕН И ИСПРАВЛЕН (CORS на YC bucket)
# ────────────────────────────────────────────────────────────────────
#
# При тестировании фазы К обнаружено что фаза Б.1.3 (фоновая загрузка
# оригиналов через presigned URL) НИКОГДА не работала из браузера.
# Все 56 тестовых фото в альбоме «Хогвартс» имели `original_path = NULL`.
#
# Корневая причина: CORS на bucket `yearbook-photos` не разрешал PUT
# запросы от origin `https://yearbook-v2.vercel.app`. Браузер блокировал
# preflight OPTIONS, PUT падал с `net::ERR_FAILED`. JS-код тихо ловил
# ошибку в .catch() через `onFileError`, но при batch загрузке 50+ фото
# уведомления перекрывали друг друга и фотограф не замечал.
#
# Симптомы:
#   - photos.original_path = NULL для всех новых фото
#   - audit_log: photo.upload_yc срабатывает, photo.register_original НЕТ
#   - PDF-export делает fallback на WebP (низкое качество в типографию)
#   - Фаза К.1 «Скачать оригиналы» возвращает 404 «нет оригиналов»
#
# ИСПРАВЛЕНО ВРУЧНУЮ В YC CONSOLE (12.05.2026, Сергей):
# bucket yearbook-photos → Безопасность → CORS → 4 правила:
#   Origins: https://yearbook-v2.vercel.app
#            https://album.okeybook.ru
#            https://okeybook.ru
#            http://localhost:3000
#   Methods: GET, PUT, POST, DELETE, HEAD
#   Headers: *
#   Expose:  ETag
#   MaxAge:  3000
#
# ⚠️ ВАЖНО ДЛЯ БУДУЩИХ СЕССИЙ:
#   - При создании НОВОГО bucket (например при переезде на новый
#     инстанс YC) — ВСЕГДА настраивать эти CORS правила сразу
#   - При смене домена (например с vercel.app на okeybook.ru) —
#     обновить origins
#   - Один и тот же баг повторится с любым presigned URL flow
#     (К.4 загрузка retouched, delivery files, в будущем — Wfolio
#     интеграция и т.д.)
#
# ────────────────────────────────────────────────────────────────────
# К.7 — фильтр по выбранным фото + Lightroom инструкция (`e1e6a5c`)
# ────────────────────────────────────────────────────────────────────
#
# По итогам теста выявлено что К.1 скачивал ВСЕ photos с original_path
# IS NOT NULL, даже если их никто из учеников не выбрал. Ретушёру это
# лишняя работа.
#
# Backend (app/api/workflow/originals-zip/route.ts):
#   - Новый параметр ?include_unselected=1 (default: фильтруем по выборкам)
#   - Логика «выбранности» по типам:
#     * portrait → JOIN selections WHERE selection_type IN ('portrait_page',
#       'portrait_cover') AND children.album_id = X. Плюс cover_selections
#       где cover_option='other' AND photo_id IS NOT NULL
#     * group → JOIN selections WHERE selection_type='group'
#     * teacher → нет селекта от родителей, выгружаем ВСЕ
#     * common_* → нет селекта (фотограф сам собирает), выгружаем ВСЕ
#   - Фильтрация на уровне JS после SELECT (правила разные для разных
#     type'ов, PostgREST не даёт это удобно выразить одним запросом)
#   - 404 ответ с filtered_out > 0 содержит подсказку про чекбокс
#   - manifest.json: добавлен only_selected: boolean
#   - audit_log: добавлен only_selected в meta
#
# README.txt в архиве — переписан с детальной инструкцией:
#   - Импорт в Lightroom Classic: File → Import → Include Subfolders →
#     режим Add (без копирования файлов)
#   - Описание режима выгрузки в шапке (только выбранные / все)
#   - Ретушь: workflow пресетов и Copy/Paste Settings для партии
#   - Экспорт (КРИТИЧНО):
#     * JPEG 90-100%, sRGB
#     * БЕЗ переименования (snimите Rename To)
#     * Image Sizing: Do not resize (полное разрешение для печати)
#     * Output Sharpening: Screen Standard или выключить
#   - Возврат в систему: «Загрузить обработанные» → автоматический матчинг
#   - Если имя случайно изменилось: про К.5 inline-привязку
#
# UI (ProductionTab):
#   - Чекбокс «Скачать также невыбранные фото» под кнопкой «📥 Скачать»
#   - По умолчанию ВЫКЛЮЧЕН → только выбранные portrait/group + все
#     teacher/common_*
#   - title кнопки динамически меняется в зависимости от режима
#   - Если 404 с filtered_out > 0 → нотификация подсказывает включить чекбокс
#
# ────────────────────────────────────────────────────────────────────
# Bulk delete: «✕ Удалить все (N)» в категориях (`4d662bd`)
# ────────────────────────────────────────────────────────────────────
#
# Запрошено Сергеем по итогам тестирования — быстрая очистка тестовых
# альбомов и случаев когда фотограф загрузил весь батч не в ту категорию.
#
# Backend (app/api/tenant action=delete_photos_by_type):
#   - Body: { album_id, photo_type }
#   - Auth: owner/manager/superadmin (viewer запрещён)
#   - Whitelist photo_type из 8 валидных категорий
#   - Проверка album_id через assertAlbumAccess (НЕ принимает view_as
#     потому что POST handler в /api/tenant не определяет tid)
#   - Удаление файлов из YC (storage_path + thumb_path + original_path)
#     батчами по 50 — защита от Vercel timeout при тысячах фото
#   - Удаление связей (selections, photo_children, photo_teachers,
#     photo_locks) одним IN()-запросом каждое
#   - Сброс submitted_at у затронутых детей
#   - audit_log: photo.delete_by_type
#   - Response: { deleted, resetChildren }
#
# UI (PhotosTab в активном табе категории):
#   - Кнопка «✕ Удалить все (N)» рядом со счётчиком фото справа
#   - Только canEdit=true и photos.length > 0
#   - Конфирм через window.prompt — требует ввести 'УДАЛИТЬ' заглавными
#     буквами (защита от случайного клика)
#   - После удаления: setPhotos([]) + нотификация с числом фото и
#     количеством сброшенных учеников
#
# ────────────────────────────────────────────────────────────────────
# ПОЛНЫЙ СПИСОК КОММИТОВ 12.05.2026 (8 шт)
# ────────────────────────────────────────────────────────────────────
#
# K.1  0a8ebc6  backend endpoint GET /api/workflow/originals-zip
# K.2  409d150  UI кнопка «Скачать оригиналы» во вкладке Производство
# K.3  9c92729  backend actions register/rebind/discard_retouched
# K.4  ff05e60  UI загрузки обработанных оригиналов + summary матчинга
# K.5  d89f633  inline-привязка unmatched к photo_id вручную
# K.6  12b2b31  context v53 — фаза К полностью закрыта
# bulk 4d662bd  массовое удаление фото категории в PhotosTab
# K.7  e1e6a5c  фильтр по выбранным фото + Lightroom инструкция в README
#
# Плюс ручное действие: CORS на YC bucket (через console.cloud.yandex.ru).
#
# ────────────────────────────────────────────────────────────────────
# ИСТОРИЧЕСКИЙ ДОЛГ: альбомы загруженные до 12.05.2026
# ────────────────────────────────────────────────────────────────────
#
# Все альбомы где фото загружались до фикса CORS — имеют photos с
# original_path = NULL. Это значит:
#   - PDF-экспорт делает fallback на WebP версии (низкое качество)
#   - К.1 «Скачать оригиналы» вернёт 404
#   - Партнёр не сможет нормально передать в типографию
#
# Сколько таких — можно посчитать в Supabase:
#   SELECT
#     a.title, a.id, a.created_at,
#     COUNT(p.id) AS total_photos,
#     COUNT(p.original_path) AS with_original,
#     COUNT(p.id) - COUNT(p.original_path) AS without_original
#   FROM albums a
#   LEFT JOIN photos p ON p.album_id = a.id
#   GROUP BY a.id
#   HAVING COUNT(p.id) > 0 AND COUNT(p.original_path) < COUNT(p.id)
#   ORDER BY a.created_at DESC;
#
# Варианты восстановления (BACKLOG, не делалось):
#   1. Просить партнёров перезалить фото в боевые альбомы — простой
#      путь для небольших альбомов, но потеряются selections учеников
#   2. Кнопка «Догрузить оригиналы» в галерее — фотограф выбирает
#      файлы локально, система не создаёт новые photos, а только
#      заливает оригиналы и привязывает к существующим photo по
#      filename. Не теряет selections.
#   3. Принять что эти альбомы пойдут в типографию с WebP качеством
#      (для альбомов уже отгруженных в OkeyBook на вёрстку — приемлемо)
#
# Решение принимается когда станет известно сколько боевых альбомов
# в зоне риска.
#
# ────────────────────────────────────────────────────────────────────
# КЛЮЧЕВЫЕ ФАЙЛЫ И МЕСТА (обновлено для v54)
# ────────────────────────────────────────────────────────────────────
#
# Backend:
#   app/api/workflow/originals-zip/route.ts  — К.1, К.7 (фильтр выбранных)
#   app/api/workflow/route.ts                — К.3 actions
#   app/api/tenant/route.ts                  — delete_photos_by_type (~2318)
#   app/api/upload-url/route.ts              — presigned URL (требует CORS!)
#
# Frontend (app/app/page.tsx ~7900 строк):
#   AlbumDetailModal (~1962): передача viewAsTenantId в ProductionTab
#   PhotosTab (~3856): кнопка «✕ Удалить все (N)»
#   uploadFilesParallel (~3733): фоновая Б.1.3 (нужен CORS!)
#   ProductionTab (~6620): блок «Цветокор и ретушь» с чекбоксом
#     «Скачать также невыбранные фото»
#
# Lib:
#   lib/storage.ts — без изменений
#
# Схема БД:
#   photos.original_path — обновляется in-place после ретуши
#   selections (portrait_page/portrait_cover/group) — источник «выбранности»
#   cover_selections (cover_option='other') — обложка как доп фото
#   Никаких новых таблиц/миграций в v54 не было
#
# Новые audit_log actions с момента v53:
#   photo.delete_by_type — массовое удаление категории
#   workflow.download_originals_zip — теперь с only_selected в meta
#
# ────────────────────────────────────────────────────────────────────
# КАНДИДАТЫ НА СЛЕДУЮЩУЮ РАБОТУ (по приоритету)
# ────────────────────────────────────────────────────────────────────
#
# 🟡 Фаза Л — Редактор макета MVP (10-14 дней)
#   Главная оставшаяся функциональная дыра. Не зависит от ответов
#   дизайнера. Konva canvas (есть инфра из фазы 0.8 продукта B для
#   просмотра мастеров), редактирование album_layouts, текст, замена
#   фото, undo/redo. Подробности в roadmap-after-phase-3.md
#   секция «Фаза Л».
#   Л.3 включит точечную замену оригинала (отложено из К).
#
# Параллельный backlog (мелочи, можно вставить между фазами):
#   1. Бэкфилл оригиналов для старых альбомов — кнопка «Догрузить
#      оригиналы» в галерее, матчинг по filename как в К.4. См.
#      раздел «ИСТОРИЧЕСКИЙ ДОЛГ» выше.
#   2. UX-улучшение Б.1.3 — бейджик «оригинал не загружен» на photo
#      в галерее, чтобы тихие падения были видимы. Сейчас CORS
#      исправлен, но любой другой сбой (network, YC rate limit)
#      приведёт к тому же. Профилактика.
#   3. view_as поддержка в /api/upload-url и /api/workflow actions
#      register/rebind/discard_retouched — чтобы сотрудник OkeyBook
#      через partner cabinet (не superadmin) мог загружать retouched
#      от имени партнёра.
#   4. Streaming ZIP для альбомов >200 фото — если станет нужно для
#      больших школ.
#   5. Модал К.5 с поиском+thumbnails вместо нативного datalist
#      (для мобильных, если будут жалобы).
#
# ⏳ Когда придут ответы дизайнера:
#   - Фаза Г (печать в типографию) — блок 1, 11
#   - Фаза Е (обложка) — 15
#   - Фаза Д (размеры) — 17/18
#
# ────────────────────────────────────────────────────────────────────
# 🔵 БИЛЛИНГ — БУДУЩАЯ ЗАДАЧА (без изменений с v53)
# ────────────────────────────────────────────────────────────────────
#
# Партнёры будут платить за сервис, но модель оплаты не определена.
# План: запуск партнёрки в июле начать с ручной оплаты, реальную
# инфраструктуру делаем когда наберётся 10+ партнёров и станет
# понятна модель. Подробности в v52.
#
# Дополнительно (12.05.2026): кнопка «Передать в OkeyBook» во вкладке
# Производство остаётся (Сергей подтвердил). Это legacy-флоу для
# партнёров которые хотят отдать вёрстку OkeyBook на ручную обработку.
# В будущем — отдельная подфаза «Передача готового макета на печать
# в OkeyBook» как продолжение текущего delivery-флоу. Прорабатывается
# позже когда будет более ясная модель.
#
# ────────────────────────────────────────────────────────────────────
# СВЯЗЬ С PDF-ЭКСПОРТОМ
# ────────────────────────────────────────────────────────────────────
#
# Layout не пересобирается после ретуши, потому что original_path
# обновляется in-place в таблице photos. При следующем экспорте PDF
# (фаза 3 продукта B) — новые версии используются автоматически.
#
# Альбомы с original_path = NULL (созданные до фикса CORS) — PDF-export
# делает fallback на storage_path (WebP). Качество для печати ниже,
# но альбом всё равно соберётся.
#
# ────────────────────────────────────────────────────────────────────
# ПРОВЕРКИ ДЛЯ СЛЕДУЮЩЕЙ СЕССИИ
# ────────────────────────────────────────────────────────────────────
#
# При старте новой сессии в Claude (особенно если что-то пойдёт
# не так с CORS / оригиналами):
#
# 1. Проверь что CORS на YC bucket всё ещё корректен:
#    Yandex Cloud Console → Object Storage → yearbook-photos →
#    Безопасность → CORS. Должны быть 4 origin'а (vercel.app,
#    album.okeybook.ru, okeybook.ru, localhost:3000).
#
# 2. Если фото не догружают оригинал — открой DevTools → Network,
#    проверь что PUT в yandexcloud.net идёт со статусом 200/204,
#    а не ERR_FAILED. Если ERR_FAILED — снова что-то с CORS.
#
# 3. Если К.1 возвращает 404 «нет выбранных фото» — это нормально,
#    включи чекбокс «Скачать также невыбранные фото».
