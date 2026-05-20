# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v115
# Обновлено: 20.05.2026 (после РЭ.24.7 — галка is_recommended в /super/presets).
#
# ФАЗА РЭ.24 — Готовые шаблоны для быстрого старта партнёра (В РАБОТЕ)
# ──────────────────────────────────────────────────────────────────
# ✅ РЭ.24.0..24.5 — основная фаза закрыта
# ✅ РЭ.24.5b — multi-design расширение
# ✅ РЭ.24.7 (d3ec8a8) — галка 'Показывать в каталоге' в PresetEditorModal:
#    • Тип Preset: добавлено is_recommended: boolean
#    • UI: голубая плашка с чекбоксом и пояснением, только для
#      глобальных пресетов (tenant_id===null)
#    • API rule_preset_update: обработка is_recommended (boolean
#      валидация + only-global ограничение)
#    • API rule_presets_list: добавлено is_recommended в SELECT
#    • app/app/templates/[designId]/page.tsx handleEdit: передаёт
#      is_recommended в EditableP
#    Скрытый баг закрыт по ходу: проверка Object.keys(patch).length=0
#    стояла ДО обработки is_recommended → API отвечал «нечего
#    обновлять» при изменении только галки. Перенёс ВЫШЕ проверки.
#
# ⏳ Следующий подэтап: РЭ.24.6 — модалка выбора шаблона при создании альбома.
#    Откладывается на следующую сессию — это рискованный подэтап
#    трогает существующую форму создания альбома в проде.
#    Архитектурный план (зафиксирован в обсуждении):
#      • Старые селекты config_type + print_type ОСТАВИТЬ в форме
#        для обратной совместимости. Старые альбомы продолжают
#        создаваться через них как раньше.
#      • ДОБАВИТЬ новое поле 'Шаблон (опционально)' с кнопкой
#        'Выбрать шаблон' → открывает TemplatePickerModal.
#      • Модалка показывает: 'Мои шаблоны' сверху + 'Готовые от
#        OkeyBook' по дизайнам. Невалидные → disabled.
#      • При сохранении:
#          - Если шаблон выбран → section_structure_preset_id =
#            id шаблона, template_set_id = template_set_id шаблона.
#            Legacy preset_slug НЕ устанавливаем.
#          - Если шаблон НЕ выбран → legacy flow как сейчас
#            (config_preset_id из preset_slug).
#      • Старые альбомы (config_preset_id != NULL) продолжают
#        собираться через legacy buildAlbum.
#      • НЕ блокировать создание альбома без шаблона (вариант A) —
#        фотографы хотят начинать отбор фото до согласования дизайна.
#
# 📌 Архитектурный долг — РЭ.27 (будущая фаза, после РЭ.24):
#    print_type должен жить в АЛЬБОМЕ, не в пресете. Тип листов
#    определяет ВИЗУАЛЬНУЮ МОДЕЛЬ РЕДАКТОРА (layflat → разворотный,
#    soft → постраничный). Полная спецификация в docs/phase-Р24-spec.md
#    §13. Не делаем сейчас — закрываем РЭ.24 по текущей модели.
#
# Архитектура РЭ.24 — 4 уровня:
#   1. ГЛОБАЛЬНЫЕ — presets WHERE tenant_id IS NULL
#   2. КАТАЛОГ /app/templates ✅ (двухуровневая навигация, мульти-дизайн)
#   3. ЛИЧНАЯ БИБЛИОТЕКА — presets WHERE tenant_id = X
#   4. ВЫБОР ПРИ АЛЬБОМЕ — модалка (РЭ.24.6, осталось сделать)
#
# Подэтапы фазы:
#   ✅ 24.0..24.5 — закрыты
#   ✅ 24.5b — multi-design расширение
#   ✅ 24.7 — галка is_recommended в редакторе
#   ⏳ 24.6 — UI: модалка выбора шаблона при создании альбома
#      24.8 — summary + контекст
#
# 🎉 ФАЗА РЭ.23 ЗАКРЫТА — визуальный каталог мастеров.
# 🎉 ФАЗА РЭ.22 ЗАКРЫТА — двух-осевая модель + семантический engine.
#
# ─── Скрытые баги фазы РЭ.22 (все закрыты по ходу) ────────────────────
# • #1 (РЭ.22.2): loaders.ts не пробрасывал student_* поля
# • #2 (РЭ.22.6): известная коллизия L-Grid-12 vs N-Grid-Page (D.1)
# • #3 (РЭ.22.7.2): legacy ищет G-Teachers-4x3, в БД G-Teachers-3x4
# • #4 (РЭ.22.8.1 fix 5187361): CHECK constraint без 'final'
#
# ─── Скрытые баги фазы РЭ.24 (закрыты по ходу) ───────────────────────
# • #1 (РЭ.24.3): пустой section_structure давал engine status='ok'
#   с 0 spreads → ранний выход до fallback. Закрыт флагом
#   engineProducedPages.
# • #2 (РЭ.24.7): проверка patch.length===0 стояла ДО обработки
#   is_recommended → API не сохранял галку. Закрыт перестановкой.
#
# ─── Известные аномалии данных ────────────────────────────────────────
# • L-Grid-12: is_spread=true, но placeholders только в левой половине.
#   Не баг превью, аномалия БД. Исправить при пересохранении из InDesign.
#
# ─── Предыдущая сессия (закрыта) — Доработка редактора Р.1+Р.2+Р.3 ────
# 20.05.2026, три новые фичи редактора /app/album/[id]/layout. См. коммиты
#   45776ed (Р.1), 15a3303 (Р.2), b4bcb88 (Р.3).
#
#   Р.1 — каскад EXACT → NORMALIZED → BY_TYPE в lib/template-replace
#         при смене SpreadTemplate. Точное / нормализованное (lowercase
#         + non-alphanumeric) / по типу placeholder. Каждый old-label
#         используется ≤1 раз, type-mismatch не срабатывает. Служебные
#         ключи __scale__/__offset__/__rotate__/__fontSize__/__color__
#         мигрируют вместе с label; __hidden__/__pos__ отбрасываются
#         (привязаны к рамкам старого мастера). Confirm с предупреждением
#         показывается ТОЛЬКО при stats.lost > 0 после умного matching.
#         26 unit-тестов нового модуля.
#
#   Р.2 — поворот фото внутри рамки (горизонт). Новый служебный ключ
#         __rotate__<label> (градусы, диапазон ±45°, шаг 0.5°). В
#         lib/photo-transform: parseRotate, serializeRotate, ROTATE_MIN/MAX,
#         computeAutoZoomForRotation. Auto-zoom factor = |cos θ| +
#         max(W/H, H/W)*|sin θ| гарантирует что повёрнутая картинка
#         покрывает рамку без видимого фона по углам. В AlbumSpreadCanvas
#         PhotoSlot — Group + clipFunc + KonvaImage с rotation. В PDF
#         (lib/pdf-export/photo-embed) добавлен ROTATE PATH третьей
#         веткой (extract enlarged → resize → rotate → cover-resize).
#         В PhotoTransformPanel добавлен третий контрол — slider ±45°
#         с двойным кликом на label для сброса только поворота. 15
#         новых тестов photo-transform (всего 48/48).
#
#   Р.3 — override размера (мультипликатор 0.5–2.0 от placeholder.font_size_pt)
#         и цвета (палитра 10 фиксированных HEX) текста. Новые ключи
#         __fontSize__<label> и __color__<label>. Новый модуль
#         lib/text-style (parseFontSizeMult, serializeFontSizeMult,
#         parseColor, serializeColor, isColorInPalette, hasCustomTextStyle,
#         TEXT_STYLE_PALETTE из 10 цветов: 4 ахроматических + 6
#         классических для выпускных). Новый компонент TextStylePanel
#         (slider + цветовые swatch'и) открывается одновременно с
#         TextInlineEditor. AlbumSpreadCanvas TextSlot и TextInlineEditor
#         принимают props fontSizeMult/colorOverride. PDF text-shaping
#         расширен optional fontSizeMult/colorOverride. 28 unit-тестов
#         нового модуля. Мультипликатор, а не абсолют — корректно
#         мигрирует при смене мастера.
#
#   vitest: 316/316 passing (247 → 273 → 288 → 316 по подэтапам).
#   tsc + next build зелёные. Все 4 коммита запушены на main.
#
#   Стратегически: короткая сессия «доработка редактора» закрыта.
#   Следующая сессия — большая фаза РЭ.22 (полный семантический
#   конструктор пресетов с двух-осевой моделью).)
#
# ⚠️ ВАЖНО: ПРЕЖДЕ ЧЕМ ПРИНИМАТЬСЯ ЗА ЛЮБУЮ ДРУГУЮ РАБОТУ — ПРОЧИТАЙ:
#   docs/phase-Р20-spec.md                — ✅ ТЗ РЭ.20 (18.05.2026)
#   docs/templates/album-structure-matrix.json — машинно-читаемая матрица
#   docs/templates/album-structure-matrix.xlsx — оригинал от дизайнера
#   docs/okeybook/album-autoverstka-okeybook.xlsx  — эталонная таблица
#     OkeyBook автоверстки. ✅ Зашита в lib/rule-engine/album-structure-
#     okeybook.ts (РЭ.21.8.9-11). 26 строк × density × sheet_type ×
#     обяз+доп+переходная.
#   docs/templates/master-cleanup-tz.md   — TZ на доработку библиотеки
#     мастеров. +Раздел H (РЭ.21.8.11b): 9 комбо-мастеров для левой
#     стороны переходной страницы.
#   docs/phase-content-edit-spec.md       — ✅ спецификация КЭ v1.1
#   docs/rule-engine-spec.md              — ✅ спецификация rule engine v1.3
#   docs/templates/architecture-decisions-2026-05-15.md
#   docs/templates/composition-catalog.md
#   docs/phase-l-spec.md
#   docs/roadmap-after-phase-3.md
#
# СТАТУС: КОНЕЦ СЕЗОНА (май 2026), ПОДГОТОВКА К АВГУСТУ
# Сезон передан сотрудникам. Главная задача — боеготовность к августу
# (запуск партнёрской программы). Главные блокеры сняты:
#   ✅ Rule engine end-to-end в проде
#   ✅ Контент-редактор фото (scale + offset + rotate ±45°, Р.2 20.05.2026)
#   ✅ Балансировка end-to-end (__hidden__/__pos__ работает в Canvas+PDF)
#   ✅ Новый Section Structure engine end-to-end в проде (РЭ.21.8.1-8)
#
# Главный оставшийся блок — реализация таблицы автоверстки OkeyBook
# в Section Structure engine (РЭ.21.8.9..12). Это превращает Section
# Structure engine из «engine который рисует пустые рамки общего раздела»
# в «engine, который делает 80-90% готового альбома без ручной доработки».
# Без этого партнёры получают полуфабрикат, а цель продукта — «нажал
# кнопку → готовый альбом».
#
# Workflow производства готов. Партнёрский кабинет готов.
# Личный разворот реализован. CRM готов.
# Все фото в Yandex Object Storage.
# Цветокор/ретушь end-to-end (К — 12.05.2026).
# Редактор макета готов (Л — 12.05.2026).
# Структурное редактирование (М — 12.05.2026 вечер).
#
# Rule engine end-to-end в проде (legacy, оставлен как fallback):
#   ✅ Спецификация v1.3 + 7 семейств + 46 правил + 7 пресетов
#      (РЭ.19.1: +6 правил Light/Mini final-разворотов с общим фото)
#   ✅ Алгоритм buildFromRules + adapter 1:N (РЭ.10..РЭ.18)
#   ✅ 159 unit tests (rule engine + photo-transform + balance-overrides)
#   ✅ Singleton-fix + UI селектор движка
#
# Section Structure engine end-to-end в проде (РЭ.21.8 — ПОЛНОСТЬЮ ЗАКРЫТА 20.05.2026):
#   ✅ buildFromSectionStructure — новый engine, читает preset.section_structure
#      (РЭ.21.2-7 UI пресетов уже это пишет в БД).
#   ✅ Три параллельных engine'а: legacy → rules → section_structure
#      с приоритетом по полям albums.section_structure_preset_id →
#      albums.rules_preset_id → albums.config_preset_id и fallthrough на
#      сбоях.
#   ✅ 379/379 unit tests passing — самое большое покрытие в проекте.
#   ✅ UI селектор «🧱 SECTION STRUCTURE» рядом с фиолетовым «🧪 Rule Engine».
#   ✅ Sandbox endpoint /api/layout?action=build_album_test_section_structure
#      + UI в /super/templates/[id]/ для тестирования.
#   ✅ Manual режим common: { type: 'common', slots: [H, Q, flex_A, ...] }.
#   ✅ Auto режим common: { type: 'common', mode: 'auto', max_spreads: N }
#      жадный по крупности (full → half → quarter → sixth).
#   ✅ Эталонная таблица OkeyBook автоверстки зашита в коде
#      (lib/rule-engine/album-structure-okeybook.ts, 26 строк, 4 шаблона
#      страниц, 3 шаблона дополнительного раздела).
#   ✅ Три новые секции:
#      - common_required (РЭ.21.8.9) — обязательный общий раздел по таблице
#      - common_additional (РЭ.21.8.10) — платная допуслуга, max_spreads
#      - transition (РЭ.21.8.11) — переходная правая страница (вариант C)
#   ✅ Семантический поиск мастера ученика (РЭ.21.8.15) — задел для РЭ.22:
#      lib/rule-engine/master-finder.ts + новые поля presets.student_*
#      (student_pages_per_student, student_friend_photos, student_has_quote)
#      + slot_capacity теги has_quote/has_portrait/has_name. Активно только
#      для Individual когда все 3 поля NOT NULL у пресета.
#   ✅ Maximum density в students секции (РЭ.21.8.14) — 1 ученик = 1 разворот
#      через E-Max-Left + E-Max-Right.
#   ✅ Балансировка __hidden__ для пустых слотов учительского разворота
#      (РЭ.21.8.13) — лишние subjectphoto_N автоматически скрываются.
#   ✅ UI редактор пресетов /super/presets (РЭ.21.8.12) — суперадмин может
#      редактировать все пресеты без SQL: density, sheet_type, min/max pages,
#      section_structure (drag-like через стрелки), student_* поля.
#
#   ⚠️ Открытые вопросы → перенесены в РЭ.22 (см. секцию "ЧТО ДАЛЬШЕ"):
#   - Семантический поиск для сеточных мастеров (Medium/Light/Mini grid)
#     — сейчас работает только для Individual. Universal/Standard/Maximum
#     идут по жёстким именам.
#   - UI редактор пресетов — двух-осевая модель «режим × параметры»
#     (1 ученик/страница vs 1 ученик/разворот vs сетка N учеников),
#     цитата зависит от выбранного режима.
#   - Левая сторона переходной страницы (комбо «N учеников + 1 общая»)
#     — отложено в РЭ.21.8.11b. Требует 9 новых мастеров от дизайнера
#     (см. master-cleanup-tz.md раздел H).
#
# Финал-развороты Light/Mini (РЭ.19.1) — частичная реализация 17.05.2026:
#   ✅ РЭ.19.1 (a8f5e26) — 6 правил light/mini-final-* с общим фото
#   ⚠️  Это аппроксимация. Полная матрица — РЭ.20 (см. ниже).
#
# Матрица структуры альбома (РЭ.20) — ТЗ написано 18.05.2026:
#   ✅ docs/phase-Р20-spec.md — полное ТЗ + 11 подэтапов
#   ✅ docs/templates/album-structure-matrix.json — 28 записей
#   ✅ РЭ.20.2 (715add1) — миграция БД: total_pages + density + sheet_type
#      в presets. Применена в Supabase 18.05.2026.
#      ⚠️ В БД нет 'mini-hard' пресета (только mini-soft). Сергей подтвердил:
#      Мини существует на плотных. В РЭ.20.5 завести mini-hard.
#   ✅ РЭ.20.3 (45848e2) — расширение TypeScript типов 18.05.2026:
#      • Preset.total_pages (required), density/sheet_type (nullable до РЭ.20.5)
#      • Новые типы: SheetType, PresetDensity, PagePattern (5 вариантов)
#      • RuleContext.pages_remaining + mandatory_section (optional)
#      • RulesAlbumInput.common_section_max_spreads → @deprecated
#   ✅ РЭ.20.4 (f0d9c23) — album-structure-matrix модуль 18.05.2026.
#   ✅ РЭ.20.5 (37029b3) — data-миграция значений 18.05.2026:
#      • UPDATE: standard/universal/medium/light получили density=<id>,
#        sheet_type='hard'. mini-soft → density='mini', sheet_type='soft'.
#      • Maximum/Individual: density=NULL (особые случаи, не покрываются
#        матрицей; продолжают работать на legacy-правилах), sheet_type='hard'.
#      • INSERT mini-hard как копия mini-soft.  ❌ ОТКАЧЕН (см. ниже).
#      • total_pages везде остался DEFAULT 24 — сезонные изменения, ставит
#        партнёр через UI в РЭ.12.
#      ⚠️ Применить вручную: migrations/2026-05-18-presets-density-sheet-type-values.sql
#   ✅ ROLLBACK mini-hard (127f50f, 18.05.2026):
#      Архитектурное уточнение от Сергея: sheet_type = АТОМАРНАЯ НАСТРОЙКА,
#      не отдельный пресет. Один пресет («Мини», «Лайт», «Стандарт» и т.д.)
#      покрывает обе версии листов; правила для S-Intro/S-Final активируются
#      только когда sheet_type='soft'. На плотных — учительский разворот
#      сразу с первой страницы. План: на этапе РЭ.12 sheet_type переедет
#      на уровень albums (не presets). Партнёр выбирает плотные/мягкие
#      при создании альбома, не пересоздавая пресет.
#      ⚠️ Применить вручную: migrations/2026-05-18-rollback-mini-hard.sql
#   ✅ РЭ.20.6.1 (6be5ab5, 18.05.2026) — инфраструктура consumes для
#      бюджета страниц и продвижения по mandatory_section:
#      • ConsumesClause + ConsumesClauseSchema: добавлены поля
#        pages?: number и mandatory_section?: { pages?: number }.
#      • build.ts:runBuild инициализирует cursors.current_consumed_pages
#        и cursors.current_mandatory_page_index.
#      • advanceCursors инкрементит их когда правило их потребляет.
#   ✅ РЭ.20.6.2 (a8d82cb, 18.05.2026) — RuleContext.preset_density +
#      preset_sheet_type + 7 JSON-пресетов синхронизированы с БД.
#   ❌ РЭ.20.6.3 (d50f8ec, ОТКАЧЕНО в e82ea73, 18.05.2026):
#      Сгенерировано было 183 правила, но семантика неверна:
#      ячейка = страница, не разворот; flex_A/B/C — слоты с
#      встроенной цепочкой попыток (collage→half→full), не альтернативы.
#      Эталон — пользовательский скрипт build_album.jsx::pushCommonSlot.
#      Также Сергей разъяснил: цепочки приоритетов НЕ должны быть
#      зашиты в код, у каждого фотографа свои.
#
# ============================================================
# РЭ.21 — новая архитектура структуры альбома (18.05.2026)
# ============================================================
# После rollback'а РЭ.20.6.3 переосмыслили подход. Финальная архитектура
# подтверждена Сергеем в ходе обсуждения через fottobot-аналогию.
#
# ## Три ортогональных уровня кастомизации:
#   1. ДИЗАЙН (визуал) — template_set, набор мастеров одного стиля.
#      Партнёр выбирает в форме пресета. Это разработка дизайнера.
#      На запуск — пользуемся только наборами OkeyBook (загруженными
#      через /super/templates). 20+ дизайнов в библиотеке. Партнёрам
#      загружать свои IDML НЕ даём пока (отложено).
#   2. СТРУКТУРА АЛЬБОМА — preset.section_structure (jsonb массив).
#      Какие секции, в каком порядке, что внутри общего раздела.
#      Партнёр редактирует свой пресет (можно копировать твои дефолты).
#   3. КОНКРЕТНЫЙ МАСТЕР — кнопка «Заменить шаблон» в редакторе разворота.
#      Уже работает в проде с фазы Л.M. Партнёр меняет финальные 20%
#      после автосборки.
#
# ## Сделано на сегодня (РЭ.21.1 → РЭ.21.4):
#   ✅ РЭ.21.1 (5d38b77) — миграция БД: presets.section_structure jsonb.
#      ⚠️ Применена в Supabase.
#   ✅ РЭ.21.2 (046afe5) — дефолты для 7 пресетов (mini/individual:
#      [H, flex_A, FULL, flex_A, flex_B, flex_B]; standard/universal/
#      medium/light/maximum: [Q, Q, H, flex_A, flex_A, flex_A, flex_B,
#      flex_B]). ⚠️ Применена в Supabase.
#   ✅ РЭ.21.3 (b0497bc) — UI просмотра в /app:
#      • Кнопка «Пресеты» в toolbar.
#      • Модал PresetsModal + GET action rule_presets_list.
#      • Карточки PresetCard с meta + SectionStructureDisplay
#        (человеко-читаемое отображение секций и слотов).
#   ✅ РЭ.21.4 (7917489) — создание пресета с нуля:
#      • Кнопка «+ Новый пресет» в модале.
#      • Форма PresetCreateForm: имя, тип печати, число страниц.
#      • POST action rule_preset_create — создаёт пресет
#        со стартовой структурой [soft_intro, teachers, students,
#        common(H, flex_A, flex_A, flex_B), soft_final].
#      • ID = 'custom-{8 random chars}', text slug, tenant_id =
#        auth.tenantId. Появляется в списке с бейджем «мой».
#   ✅ РЭ.21.5.1 (057bf79) — миграция БД: presets.min_pages + max_pages
#      (nullable, без дефолтов). total_pages пока остаётся как фолбэк.
#      ⚠️ Применена в Supabase 18.05.2026 — у 8 пресетов (7 встроенных +
#      custom-vrfxcuqi) обе колонки = NULL.
#   ✅ РЭ.21.5.2 (db3adbb) — типы + API + форма + карточка:
#      • lib/rule-engine/types.ts: Preset.min_pages?/max_pages? nullable.
#        total_pages помечен @deprecated.
#      • lib/rule-engine/loaders.ts: presetRowToPreset читает оба поля.
#      • app/api/tenant: rule_presets_list select + rule_preset_create
#        принимает min_pages/max_pages с валидацией 1..200 + min<=max.
#        Legacy total_pages в БД пишется = max_pages (для совместимости
#        сборщика, который пока ходит через total_pages).
#      • app/app/page.tsx: PresetCreateForm — два инпута с inline
#        валидацией. PresetCard — pagesLabel показывает «N стр.» если
#        min=max или «N–M стр.» если разные. Фолбэк на total_pages
#        пока партнёр не заполнил диапазон.
#      • Sergei ещё НЕ проставил диапазоны для 7 встроенных — это шаг
#        вне разработки, SQL в разделе «Дальше» этого файла.
#   ✅ Шаг B (вручную через Supabase SQL Editor 18.05.2026):
#      Сергей применил UPDATE для 7 встроенных пресетов (см. диапазоны
#      в РЭ.21.5.3 ниже). custom-vrfxcuqi оставлен с NULL — намеренно,
#      это тестовый пресет.
#   ✅ РЭ.21.5.3 (DROP COLUMN total_pages + fb69a30):
#      • SQL миграция применена Сергеем ВРУЧНУЮ 18.05.2026:
#          UPDATE presets
#          SET min_pages = COALESCE(min_pages, total_pages),
#              max_pages = COALESCE(max_pages, total_pages)
#          WHERE min_pages IS NULL OR max_pages IS NULL;
#          ALTER TABLE presets DROP COLUMN total_pages;
#        НО: миграция применена ДО кодовых правок. Между моментом
#        DROP COLUMN и деплоем fb69a30 прод падал на:
#          - /app → «Пресеты» (rule_presets_list SELECT с total_pages),
#          - создании пресета (INSERT),
#          - сборке альбома (build.ts читал preset.total_pages).
#      • fb69a30 — срочный fix:
#          - app/api/tenant: SELECT/INSERT без total_pages.
#          - lib/rule-engine/types.ts: total_pages удалён из Preset.
#            min_pages/max_pages остаются nullable (custom-vrfxcuqi
#            имеет NULL — COALESCE не нашёл fallback при миграции).
#          - lib/rule-engine/loaders.ts: не читает total_pages.
#          - lib/rule-engine/build.ts: pagesRemaining =
#            (preset.max_pages ?? 24) - consumedPages. Фолбэк 24
#            для NULL legacy.
#          - app/app/page.tsx: RulePresetRow без total_pages,
#            PresetCard показывает «— стр.» если оба NULL.
#          - lib/rule-engine/__tests__/build-edge.test.ts: 4 теста
#            total_pages: 24 → max_pages: 24.
#      • Урок для будущих миграций «удаление колонок»: ВСЕГДА сначала
#        код → деплой → SQL. Не наоборот. Зафиксировано в правилах
#        работы (см. ниже).
#   ✅ РЭ.21.6.1 (df8c1f0) — миграция БД: presets.template_set_id uuid.
#      • ALTER TABLE presets ADD COLUMN template_set_id uuid REFERENCES
#        template_sets(id) ON DELETE SET NULL.
#      • CREATE INDEX idx_presets_template_set (partial, WHERE NOT NULL).
#      • UUID, а не slug — потому что slug уникален только в
#        (tenant_id, slug). См. partial unique index в
#        template-sets-slug-migration.sql.
#      • Применена Сергеем 18.05.2026. У всех 9 пресетов NULL.
#   ✅ РЭ.21.6.2 (87e894f) — бэкенд:
#      • lib/rule-engine/types.ts: Preset.template_set_id?: string|null
#        (заодно почищен висячий jsdoc от total_pages, артефакт fb69a30).
#      • lib/rule-engine/loaders.ts:
#        - presetRowToPreset читает template_set_id.
#        - loadBundle резолвит slug ИЗ ПРЕСЕТА через доп. SELECT в
#          template_sets по uuid. Если NULL/резолв упал →
#          console.warn + фолбэк 'okeybook-default'.
#        - УБРАН 4-й аргумент templateSetSlug. Иначе template_set_id
#          из пресета молча игнорировался бы (скрытый баг).
#      • lib/album-builder/index.ts: BuildAlbumOrFallbackOptions.
#        templateSetSlug удалён, вызов без 4-го аргумента.
#      • app/api/layout/route.ts: 3 вызова loadBundle перестают
#        передавать 'okeybook-default'.
#      • app/api/tenant/route.ts:
#        - rule_presets_list SELECT включает template_set_id.
#        - rule_preset_create принимает template_set_id с валидацией:
#          формат uuid + наличие в БД + доступ (is_global ИЛИ
#          tenant_id=auth.tenantId). 403 при попытке сослаться на
#          чужой template_set.
#   ✅ РЭ.21.6.3 (c10b0fa) — UI:
#      • Тип TemplateSetRow (минимум полей для UI).
#      • PresetsModal параллельно грузит template_sets через
#        GET /api/layout?action=template_sets (уже существовавший
#        endpoint).
#      • PresetCreateForm: <select> «Дизайн» добавлен перед диапазоном
#        страниц. Опции: «По умолчанию (okeybook-default)» + все
#        доступные template_sets с пометкой «глобальный».
#      • PresetCard: новая строка под meta «Дизайн: <название>».
#        Fallback на укороченный uuid если template_set не найден
#        в списке (удалён или нет доступа).
#   ✅ РЭ.21.7.1 (029ac0d) — API rule_preset_update (partial patch):
#      • Принимает: display_name, print_type (с автоапдейтом
#        sheet_type), min_pages, max_pages (cross-валидация min<=max
#        с подтягиванием из БД для отсутствующих полей),
#        template_set_id (валидация доступа).
#      • Доступ: viewer→403, глобальный пресет→403, чужой тенант→404.
#      • UPDATE с .eq('tenant_id', auth.tenantId) — защита от гонки.
#      • Если patch пустой → {ok:true, updated:false} без round-trip.
#   ✅ РЭ.21.7.2 (08d2941) — UI базового редактирования:
#      • PresetCreateForm обобщён в PresetForm с пропом mode.
#      • Заголовок/кнопка submit/подсказка адаптируются к mode.
#      • PresetCard: state editing, кнопка «Редактировать» только
#        для своих (не для глобальных). В режиме editing форма
#        заменяет содержимое карточки.
#   ✅ РЭ.21.7.3 (80b56e2) — DnD редактор секций:
#      • Чистый хелпер validateSectionStructure(raw) в начале
#        app/api/tenant/route.ts. Строгая валидация массива длины
#        <=50 с type из 6 разрешённых, common.slots из 6 разрешённых.
#      • rule_preset_create / rule_preset_update принимают
#        опциональный section_structure через этот валидатор.
#      • Импорт @dnd-kit (vertical strategy).
#      • SECTION_TYPE_LABELS / SECTION_TYPE_ORDER / SLOT_LABELS
#        синхронизированы с серверным валидатором.
#      • SectionEditor: DnD-список секций. SortableSectionItem с
#        drag handle ⋮⋮ и кнопкой удалить. AddSectionButton dropdown.
#      • PresetForm: state sections (default из существующего
#        defaultSectionStructure для create или existing.
#        section_structure для edit). submit отправляет
#        section_structure: sections.
#   ✅ РЭ.21.7.4 (0657138) — DnD редактор слотов в common:
#      • SLOT_TYPE_ORDER рядом со SLOT_LABELS.
#      • Вложенный SlotEditor с собственным DndContext. Внешний
#        (секций) и внутренний (слотов) не конфликтуют благодаря
#        привязке сенсоров к ближайшему контексту через React Context.
#      • SortableSlotItem: drag handle ⋮ (одинарный), лейбл,
#        крестик. Визуально отличается фоном gray-50 от карточки
#        секции (white).
#      • AddSlotButton: dropdown с 6 типами слотов.
#      • SortableSectionItem.onSlotsChange прокидывается только для
#        common. SectionEditor обновляет конкретную секцию через
#        immutable map с проверкой j===i.
#   ✅ РЭ.21.7.5.1 (75a36e7) — API rule_preset_create/update принимает density:
#      • validateDensity() — whitelist {standard, universal, medium,
#        light, mini, null}. Синхронизирован с PresetDensity и CHECK
#        constraint на presets.density.
#      • rule_preset_create: density читается из body (опц.) — раньше
#        хардкодилось null, задать можно было только через SQL.
#      • rule_preset_update: density добавлен в partial-patch (undefined
#        не трогаем, null сбрасываем, строка валидируется по whitelist).
#   ✅ РЭ.21.7.5.2 (3d4ad49) — UI density-dropdown внутри секции students:
#      • Тип PresetDensityValue + DENSITY_LABELS/DENSITY_ORDER в page.tsx.
#      • DensityPicker — компактный select 6 опций («по умолчанию» + 5).
#      • SectionEditor принимает density + onDensityChange, пробрасывает
#        в SortableSectionItem ТОЛЬКО для секций type='students' (по
#        аналогии с onSlotsChange для common).
#      • SortableSectionItem рендерит DensityPicker внутри карточки
#        students под лейблом, фон gray-50 как у SlotEditor.
#      • PresetForm: state density (нормализация existing.density через
#        whitelist — мусор → null), отправка в submit body для create/edit.
#      • UX: при наличии нескольких секций students все показывают
#        одно значение density (физически density один на пресет).
#   ✅ РЭ.21.7.5.3 (f95a063) — density в PresetCard под секцией students:
#      • Убрана 'плотность <X>' из верхней meta-строки (densityLabel
#        переменная удалена).
#      • SectionStructureDisplay получил новый проп density. Под лейблом
#        секции students рендерится 'Плотность: <Имя>' (через
#        DENSITY_LABELS) или 'Плотность: по умолчанию'.
#      • Значения вне whitelist трактуются как 'по умолчанию'
#        (безопасно для legacy/мусорных данных в БД).
#
# ## Замечания Сергея, требующие доработки (planned):
#   ⚠️ Подключение template_set к пресету (поле presets.template_set_id).
#      Партнёр в форме пресета выбирает «дизайн» из списка глобальных.
#   ⚠️ Редактор структуры пресета (drag-and-drop секций и слотов).
#   ⚠️ Возможность добавлять НОВЫЕ типы секций (типа 'student_plus_teachers'
#      по аналогии с обновлением fottobot). Архитектура позволяет —
#      section_structure это jsonb, новые типы просто появляются в массиве.
#      Конкретные типы будут добавляться по мере появления мастеров
#      в template_set с правильными семантическими тегами.
#   ✅ Подключение section_structure к build engine — РЕАЛИЗОВАНО в РЭ.21.8.
#      См. отдельную большую секцию ниже.
#
# ════════════════════════════════════════════════════════════════════════
# РЭ.21.8 — Section Structure engine end-to-end (май 2026)
# ════════════════════════════════════════════════════════════════════════
#
# Цель: подключить новый build engine, который читает preset.section_structure
# (РЭ.21.2-7 пишет это в БД) и строит layout альбома согласно структуре
# секций. Существует ПАРАЛЛЕЛЬНО с legacy buildAlbum и rule engine
# buildFromRules — не заменяет их, а добавляется третьим путём.
#
# Архитектурная развилка в handleBuildAlbum (приоритет engine'ов):
#   albums.section_structure_preset_id  rules_preset_id  → engine
#   ─────────────────────────────────── ──────────────── ──────────────────
#   NOT NULL (и не упал)                *                 section_structure
#   NULL/упал                           NOT NULL          rules
#   NULL/упал                           NULL/упал         legacy buildAlbum
# Fallthrough на сбоях каждой ветки — партнёр всегда получает layout.
#
# СДЕЛАНО (8 коммитов из 12 планируемых):
#
# ✅ РЭ.21.8.1 (7b91dc0) — Типы SlotType, SectionType, SectionStructureEntry,
#    SectionStructure в lib/rule-engine/types.ts. Чтение section_structure
#    из БД в loaders.ts.
#
# ✅ РЭ.21.8.2 (7b6717b) — 6 чистых функций slot-chains:
#    H (J-Half), Q (J-Quarter-Left/Right), FULL (J-Full),
#    flex_A (collage → half → full),
#    flex_B (quarter → collage → half → full),
#    flex_C (half → collage → full).
#    28 unit-тестов. Trace формат: 'flex_A → J-Collage-6 (6 sixth)'.
#
# ✅ РЭ.21.8.3 (aff7fe1) — Skeleton buildFromSectionStructure orchestrator
#    в lib/rule-engine/build-from-section-structure.ts. Возвращает
#    AlbumLayout (тот же формат что rule engine, переиспользует адаптер
#    layout-to-buildresult.ts). Status: 'ok'/'partial'/'failed'. 9 тестов.
#
# ✅ РЭ.21.8.4a (e50a0e6) — sections/teachers.ts — F-Head-* + G-* по
#    subjects_count (таблица из inventory §3). Цепочка для правой:
#    G-HalfClass → G-FullClass → пусто. Placeholder-driven bindings.
#    21 unit-тест. Архитектура: папка lib/rule-engine/sections/ с
#    SectionFillContext mutable bag.
#
# ✅ РЭ.21.8.4b (38861fb) — sections/students.ts single-page режимы.
#    После РЭ.21.8.6a Standard и Universal слиты в buildAlternatingLR
#    (оба density одинаково — два одностраничных мастера E-{Standard|
#    Universal}-Left/Right с чередованием L/R, без is_spread).
#    15 unit-тестов.
#
# ✅ РЭ.21.8.4c (7733e2e) — Grid режимы Medium/Light/Mini через
#    buildGrid(ctx, config) с конфигом per-density. Адаптивные хвосты
#    L-2/3/4, N-4/6/9 через pickAdaptiveTail. Combined-tail (M/L/N-Combined-
#    Page) с classphotoframe. Cursor-аккуратное потребление общих фото —
#    teachers G-FullClass + students combined берут разные фото. 13 тестов.
#
# ✅ РЭ.21.8.5 (de1e5ca) — sections/soft-intro.ts + sections/soft-final.ts
#    (S-Intro / S-Final с fallback на S-Final-Soft-L). Зависит от
#    preset.sheet_type='soft'. Min/max pages enforcement в orchestrator
#    (overflow обрезает + trim decision_trace; underflow только warning).
#    15 тестов.
#
# ✅ РЭ.21.8.6 (9a39313) — Sandbox endpoint
#    POST /api/layout?action=build_album_test_section_structure
#    (superadmin only) + UI в app/super/templates/[id]/page.tsx
#    (зелёный аккордеон). Возвращает masters_by_id для UI lookup имён
#    мастеров.
#
# ✅ РЭ.21.8.6a (ce98786) — Синхронизация имён мастеров с реальным
#    template_set okeybook-default после sandbox-проверки Сергеем
#    19.05.2026 (7 пресетов). Исправления:
#    - E-Student-Standard (двухстраничный, is_spread) был ошибочной
#      моделью. Реально: Standard = E-Standard-Left/Right (как Universal).
#    - J-ClassPhoto / -Right → J-Full (мастер симметричный, зеркала нет)
#    - J-Quarter → J-Quarter-Left / J-Quarter-Right с чередованием
#    - J-Collage → J-Collage-6 (в template_set есть и J-Collage-4)
#    Файлы: slot-chains/{full,q,flex-a,flex-b,flex-c}.ts +
#    sections/students.ts (буил Standard слили в buildAlternatingLR с
#    buildUniversal). 4 теста синхронизированы.
#
# ✅ РЭ.21.8.7a (a5c8c72) — Миграция БД albums.section_structure_preset_id
#    (text NULL, FK presets(id), ON DELETE SET NULL). Whitelist update_album
#    в app/api/tenant/route.ts. SELECT поля в handleBuildAlbum.
#    Применена вручную Сергеем в Supabase SQL Editor.
#
# ✅ РЭ.21.8.7b (1c2ccbf) — Маршрутизация handleBuildAlbum:
#    tryBuildViaSectionStructure() копия tryBuildViaRules с заменой
#    engine. Smart-fill (buildAlbumInput + adaptLegacyAlbumInput),
#    адаптер adaptAlbumLayoutToBuildResult переиспользованы как есть
#    (новый engine отдаёт тот же AlbumLayout). Audit log с
#    engine='section_structure'. Защита от пресета без section_structure
#    (возврат ok=false, caller делает fallthrough).
#
# ✅ РЭ.21.8.7c (429a33f) — UI компонент SectionStructurePresetControl
#    в /app (зелёный, рядом с фиолетовым RulesPresetControl). Dropdown
#    с 8 опциями (Выключен + 7 пресетов: standard/universal/maximum/
#    individual/medium/light/mini-soft). Сохранение через
#    POST /api/tenant action=update_album. Архитектура B
#    (два независимых селектора рядом, не объединены).
#
# ✅ РЭ.21.8.8 (8c38ee7) — Реальные bindings для common + auto-режим.
#    Закрыты два пробела:
#    1. common-страницы создавались с пустыми bindings={} — фото общего
#       раздела не подставлялись (партнёр получал пустые рамки).
#       Теперь placeholder-driven mapping: classphotoframe, halfphoto_N,
#       quarterphoto_N, collagephoto_N, spreadphoto_N. Cursor через
#       arr.length - available[k] как в teachers.
#    2. Новая форма common-секции для autopack:
#       { type: 'common', mode: 'auto', max_spreads: N }
#       Жадный по крупности алгоритм (J-Full → J-Half → J-Quarter →
#       J-Collage-6 → J-Collage-4), принцип «лучше меньше разворотов
#       чем пустые слоты» (откат при невозможности заполнить разворот
#       целиком). Spread фото игнорируются с warning common_no_spread_master
#       (мастер J-Spread отсутствует в template_set — master-cleanup-tz §A5).
#    Валидатор validateSectionStructure расширен — discriminated union
#    по полю 'mode'. rule_id префикс manual режима: 'manual:H' (было 'slot:H').
#    13 новых тестов.
#
# ════════════════════════════════════════════════════════════════════════
# ФАЗА РЭ.21.8 — ИТОГИ (закрыта 20.05.2026)
# ════════════════════════════════════════════════════════════════════════
#
# Контекст: 19.05.2026 Сергей подсветил что autopack режим из РЭ.21.8.8 был
# «полуфабрикат» — продукт OkeyBook задумывался как «нажал кнопку, получил
# 80-90% готового результата». 19-20.05.2026 за 7 коммитов реализована
# эталонная таблица OkeyBook автоверстки в Section Structure engine, плюс
# UI редактор пресетов.
#
# Коммиты:
#
# ✅ РЭ.21.8.9 (1286b7b) — Обязательный общий раздел по таблице OkeyBook.
#    Новая секция { type: 'common_required' }. Файл album-structure-okeybook.ts
#    с константой OKEYBOOK_TABLE (26 строк × density × sheet_type × students_match).
#    Логика «или-или» жадно по PageAttempt. Зеркальные мастера Quarter L/R.
#    Edge case Мини плотные 25+ (пустой обязательный раздел). +25 тестов.
#
# ✅ РЭ.21.8.14 (914695b) — Maximum density в students секции.
#    Новая функция buildOnePerSpread: 1 ученик = 1 разворот через
#    E-Max-Left + E-Max-Right. Фолбэк для density=null через preset.id
#    (для 'maximum' и 'individual'). +7 тестов.
#
# ✅ РЭ.21.8.15 (e5ba1d5, hotfix 3e50d0e) — Семантический поиск мастера ученика.
#    Архитектурный задел для РЭ.22: lib/rule-engine/master-finder.ts +
#    findStudentMaster(mastersByName, request). Новые поля presets.student_*
#    (student_pages_per_student, student_friend_photos, student_has_quote).
#    SlotCapacity расширен: has_quote/has_portrait/has_name.
#    2 миграции БД: presets-student-layout-fields + okeybook-default-student-
#    master-tags (теги для 6 existing E-* мастеров).
#    Активен только для Individual когда все 3 поля NOT NULL. +14 тестов.
#
# ✅ РЭ.21.8.13 (1447424) — Балансировка __hidden__ для пустых слотов.
#    bindLeftPage и bindRightPage в teachers секции теперь выставляют
#    __hidden__<label>='1' для отсутствующих subjects, half_class фото,
#    head_teacher.photo. Canvas/PDF автоматически скрывают пустые
#    placeholder'ы (через lib/balance-overrides/, БТ.1). +4 теста.
#
# ✅ РЭ.21.8.10 (5f9dfaa) — Дополнительный общий раздел (платная допуслуга).
#    Новая секция { type: 'common_additional', max_spreads: N }.
#    TableRow расширен additional_pages (5 позиций для мягких с null
#    первой страницей, 4 для плотных). 3 шаблона: ADDITIONAL_HARD,
#    ADDITIONAL_SOFT, NO_ADDITIONAL. max_spreads=0 → секция не строится
#    без warnings. +7 тестов.
#
# ✅ РЭ.21.8.11 (4c058eb) — Переходная страница (вариант C).
#    Новая секция { type: 'transition' }. Достраивает правую страницу
#    переходного разворота когда pageInstances нечётно после students.
#    TableRow расширен transition_right (либо null, либо COLLAGE_OR_HALVES_
#    OR_FULL). Левая сторона переходной отложена в РЭ.21.8.11b — требует
#    9 комбо-мастеров от дизайнера (master-cleanup-tz.md раздел H).
#    +7 тестов.
#
# ✅ РЭ.21.8.12 (1149f41) — UI редактор пресетов в /super/presets.
#    Страница со списком + PresetEditorModal (~430 строк). Backend:
#    rule_preset_update расширен (sheet_type, student_* поля,
#    superadmin может редактировать глобальные). Базовый MVP UI —
#    полноценный конструктор «как у фотобота» отложен в РЭ.22.
#
# Активация на боевом (после применения миграций РЭ.21.8.15):
#   UPDATE presets SET section_structure = '[
#     {"type": "teachers"},
#     {"type": "students"},
#     {"type": "transition"},
#     {"type": "common_required"},
#     {"type": "common_additional", "max_spreads": 2}
#   ]'::jsonb WHERE id IN ('standard', 'universal', 'medium', 'light');
#
# Покрытие тестами: 379/379 unit tests (21 файл).
#
# ────────────────────────────────────────────────────────────────────────
# Открытые вопросы → перенесены в РЭ.22 (не делать сейчас):
# ────────────────────────────────────────────────────────────────────────
#
# 1. Семантический поиск для сеточных мастеров
#    Сейчас Medium/Light/Mini идут через жёсткие имена M-Grid-Page /
#    L-Grid-Page / N-Grid-Page в sections/students.ts (buildGrid).
#    Standard/Universal — через E-Standard-Left/Right / E-Universal-Left/Right
#    (buildAlternatingLR). Семантический поиск через findStudentMaster
#    работает только для Individual. РЭ.22 переведёт все density на
#    семантический поиск когда партнёры начнут создавать свои пресеты.
#
# 2. UI редактор пресетов — двух-осевая модель «режим × параметры»
#    Сейчас в /super/presets секция «Личный раздел» имеет только поле
#    student_pages_per_student с 2 опциями (1 страница / 2 страницы).
#    Не покрыто:
#    - Третья опция «сетка N учеников на странице» (4 для Medium,
#      6 для Light, 12 для Mini). Сейчас они описываются через density
#      поле + жёсткие имена в коде.
#    - Цитата (student_has_quote) сейчас независимое поле, но фактически
#      зависит от выбранного режима (в сетке Medium есть цитата,
#      в Light/Mini — нет).
#    - Размер сетки (3x4, 3x2, 2x2) — отдельная характеристика
#      которой сейчас в БД вообще нет.
#    Правильная модель: режим (page/spread/grid) → доступные параметры
#    разные.
#
# 3. Левая сторона переходной страницы (РЭ.21.8.11b)
#    Комбо-мастера «N учеников + 1 общая фотка»: E-Trans-1L, E-Trans-2-
#    Common-L/R, E-Trans-3-Common-L/R, E-Trans-2-Plain-L, E-Trans-3-Plain-L,
#    E-Trans-4-Common-L, E-Trans-6-L, E-Trans-12-L. 9 новых мастеров от
#    дизайнера. См. master-cleanup-tz.md раздел H. Альтернатива: расширить
#    students секцию через preset.student_transition_pages = 'separate' |
#    'combined'.
#
# 4. Создание/удаление/дублирование пресетов в /super/presets
#    Сейчас только редактирование existing. Кнопки 'Создать новый',
#    'Удалить', 'Дублировать' — не реализованы.
#
# 5. Партнёрский UI редактор пресетов в /app
#    Сейчас /super/presets доступен только суперадмину. Партнёры
#    смогут редактировать только свои пресеты (tenant_id=auth.tenantId)
#    — но UI для этого ещё не вынесен в /app.
#
# 6. UI для выбора template_set_id (дизайн пресета)
#    Сейчас в UI нет поля для выбора template_set. Партнёры по умолчанию
#    получают okeybook-default через фолбэк в loadBundle.
#
# Файлы основных артефактов фазы:
# - lib/rule-engine/album-structure-okeybook.ts (новый, ~750 строк)
# - lib/rule-engine/sections/common-required.ts (новый, ~200 строк)
# - lib/rule-engine/sections/common-additional.ts (новый, ~200 строк)
# - lib/rule-engine/sections/transition.ts (новый, ~200 строк)
# - lib/rule-engine/master-finder.ts (новый, ~180 строк)
# - app/super/presets/page.tsx (новый, ~180 строк)
# - app/super/presets/_components/PresetEditorModal.tsx (новый, ~430 строк)
# - migrations/2026-05-19-presets-student-layout-fields.sql
# - migrations/2026-05-19-okeybook-default-student-master-tags.sql
# - docs/templates/master-cleanup-tz.md +раздел H
# - Адаптивные мастера L-2/L-3/L-4, N-4/N-6/N-9 тоже не нарисованы.
#   Fallback на base-grid с null-padding работает (warning students_grid_
#   tail_padded).
# ════════════════════════════════════════════════════════════════════════
#
# ════════════════════════════════════════════════════════════════════════
# РЭ.21.8.чистка-1 (20.05.2026): удалён движок 2 (buildFromRules)
# ════════════════════════════════════════════════════════════════════════
#
# Контекст: после закрытия фазы РЭ.21.8 у нас было 3 движка сборки:
#   1. legacy buildAlbum            — работает в проде, основной движок
#   2. buildFromRules (РЭ.9-16)     — fallback fallback'а, не использовался
#                                      ни одним пресетом в боевом workflow
#   3. buildFromSectionStructure   — новый движок (РЭ.21.8)
#
# Движок 2 устарел — его таблица album-structure-matrix.json частично
# дублирует функционал buildAlbum, а Section Structure engine покрывает
# все его use-cases через эталонную таблицу OkeyBook.
#
# Стратегическое решение Сергея (20.05.2026): перед стартом большой
# фазы РЭ.22 (полноценный конструктор пресетов с двух-осевой моделью)
# убрать движок 2 чтобы не путаться в трёх движках.
#
# Коммит: 9124a96 (один атомарный коммит, ~2000 строк удалено).
#
# Удалено:
# - 6 файлов lib/rule-engine/{build,apply,evaluate,balance,schemas,
#   album-structure-matrix}.ts
# - 6 тестов __tests__/build/build-edge/apply/evaluate/balance/
#   album-structure-matrix.test.ts (132 теста)
# - scripts/seed-rule-engine.ts
# - app/api/layout: handleBuildAlbumTestRules, handlePreviewRulesEngine,
#   tryBuildViaRules + action'ы build_album_test_rules + preview_rules_engine
# - В handleBuildAlbum удалена ветка if (album.rules_preset_id) — теперь
#   только: section_structure → legacy fallback
# - В app/app/page.tsx: компоненты RulesPresetControl и
#   RulesEnginePreviewBlock + их использования
# - В app/super/templates/[id]/page.tsx: весь sandbox UI для движка 2
#   (тип RulesBuildResult, state, функция runRulesBuildTest, UI блок
#   ~200 строк)
# - В app/api/tenant: rules_preset_id из allowedFields update_album
# - lib/album-builder/index.ts: ре-экспорт buildFromRules,
#   обёртка buildAlbumOrFallback (~100 строк, никто не использовал)
#
# НЕ тронуто (общее для движка 3):
# - lib/rule-engine/legacy-adapter.ts (adaptLegacyAlbumInput)
# - lib/rule-engine/layout-to-buildresult.ts
# - lib/rule-engine/loaders.ts, master-finder.ts, types.ts,
#   album-structure-okeybook.ts, build-from-section-structure.ts,
#   sections/, slot-chains/ — это всё для движка 3
#
# Миграция БД (создана, но НЕ применена):
# - migrations/2026-05-20-albums-drop-rules-preset-id.sql
#   DROP COLUMN IF EXISTS rules_preset_id + DROP INDEX
#   Применить когда удобно — никакой пользовательский функционал
#   не зависит от этой колонки.
#
# Архитектурный долг после чистки (на будущее):
# - API action'ы rule_preset_create / rule_preset_update /
#   rule_presets_list имеют исторические имена — теперь работают
#   с общей таблицей `presets` (которую использует движок 3).
#   Переименование в preset_* возможно при UX-шлифовке /super/presets,
#   не блокер.
# - Тип Album.rules_preset_id в app/app/page.tsx помечен deprecated.
#   Можно удалить когда колонка БД будет удалена.
#
# Проверки:
# - tsc clean ✅
# - next build green ✅
# - vitest: 247/247 passing (было 379, минус 132 теста движка 2)
#
# Эффект:
# - Когнитивная нагрузка: 3 движка → 2
# - Размер кодовой базы: -~2000 строк
# - handleBuildAlbum упростился: 3 пути → 2 пути
# - Никаких пользовательских изменений нет
# ════════════════════════════════════════════════════════════════════════
#
#
# ## Семантика слотов (для следующих сессий):
#   - H, Q, FULL: фиксированные слоты (один мастер из заданной категории).
#   - flex_A, flex_B, flex_C: слоты с встроенной цепочкой попыток.
#     Цепочки определены в build_album.jsx::pushCommonSlot (строки 913-991).
#     Партнёр НЕ редактирует цепочки (Вариант А из обсуждения 18.05).
#   - Ячейка структуры = ОДНА страница, не разворот.
#   - soft_intro/soft_final активны только если у альбома sheet_type=soft.
#   - sheet_type живёт у альбома (albums.sheet_type), не у пресета. Колонка
#     ещё не добавлена — будет в РЭ.12 / РЭ.21.5.
#
# ## Эталонный скрипт InDesign (Сергей прислал 18.05.2026):
#   - build_album.jsx (2785 строк) — главный скрипт, функция pushCommonSlot
#     эталон логики слотов.
#   - build_cover.jsx (516 строк) — обложка.
#   - build_tryumo.jsx (486 строк) — трюмо (отложено).
#   Сергей назвал их «сырыми, не догма». Идеи можно брать, но дословно
#   копировать не нужно.
#
# 🎯 ОСНОВНЫЕ ОТКРЫТИЯ из обсуждения 18.05.2026:
#   1. total_pages — фиксированное число страниц альбома, атрибут ПРЕСЕТА
#      (не альбома). Партнёр настраивает в UI пресета (РЭ.12).
#   2. common_section_pages вычисляется = total_pages - student_section
#      - head_teacher - intro - final.
#   3. Логика hard/soft одинаковая, разница только в total_pages
#      (soft имеет S-Intro/S-Final по краям).
#   4. Альтернативы в матрице ('либо 6×1/6, либо 2 по 1/2, либо 1 общая')
#      резолвятся по наличию фотоматериала автоматически. Партнёр меняет
#      в редакторе если нужно иначе.
#   5. 1 разворот = 2 страницы (кроме трюмо = 3, отложено на потом).
#   6. Учительский разворот = 1 или 2 страницы в зависимости от пресета.
#
# ⚠️ ВАЖНО: ПРЕЖДЕ ЧЕМ ПРИНИМАТЬСЯ ЗА ЛЮБУЮ ДРУГУЮ РАБОТУ — ПРОЧИТАЙ:
#   docs/phase-content-edit-spec.md       — ✅ спецификация КЭ v1.1 (16.05.2026)
#   docs/rule-engine-spec.md              — ✅ спецификация rule engine v1.3
#   docs/templates/architecture-decisions-2026-05-15.md — фундамент rule engine (12 решений)
#   docs/templates/composition-catalog.md — каталог композиций
#   docs/templates/data/composition-catalog-filled-2026-05-15.xlsx — заполнен Сергеем
#   docs/phase-l-spec.md                  — спецификация фазы Л v2 (✅ ЗАКРЫТА)
#   docs/roadmap-after-phase-3.md         — план фаз до боеготовности
#   docs/designer-questions-2026-05-10.md — вопросы дизайнеру + ответы
#   docs/templates/master-cleanup-tz.md   — раздел F5 (виртуальные страницы)
#   yearbook-context-v56.md               — фазы М + техдолг детально
#   yearbook-context-v55.md               — фазы Л + П детально
#
# СТАТУС: КОНЕЦ СЕЗОНА (май 2026), ПОДГОТОВКА К АВГУСТУ
# Сезон завершают сотрудники. Главная задача — боеготовность к августу
# (запуск партнёрской программы). Снят первый и главный блокер — теперь
# партнёр может довести альбом до публикуемого качества через UI.
#
# Workflow производства готов. Партнёрский кабинет готов.
# Личный разворот реализован. CRM готов.
# Все фото в Yandex Object Storage.
# Цветокор/ретушь end-to-end работает (фаза К — 12.05.2026).
# Редактор макета готов (фаза Л — 12.05.2026).
# Структурное редактирование макета готово (фаза М — 12.05.2026 вечер).
#
# Rule engine ПОЛНОСТЬЮ В ПРОДЕ, end-to-end:
#   ✅ Спецификация v1.3 + 7 семейств + 40 правил + 7 пресетов
#      (РЭ.18.2: +4 правила common-section-*-pair для полноценного раздела)
#      (РЭ.18.4: имена мастеров согласованы с боевой БД)
#   ✅ Алгоритм buildFromRules (РЭ.9, ~1.5K строк)
#   ✅ 104 unit tests rule engine + 33 photo-transform = 137 total
#   ✅ Sandbox endpoint + UI Build Test в /super/templates (РЭ.13)
#   ✅ Preview endpoint + UI кнопка в AlbumDetailModal (РЭ.14)
#   ✅ Singleton-fix + warnings cleanup (РЭ.15)
#   ✅ albums.rules_preset_id миграция + handleBuildAlbum развилка +
#      UI селектор движка сборки (РЭ.16)
#   ✅ Адаптер 1:N — каждая страница отдельный legacy SpreadInstance (РЭ.17)
#   ✅ Полноценный общий раздел + common_section_max_spreads (РЭ.18)
#
# Контент-редактор фото (КЭ) ПОЛНОСТЬЮ В ПРОДЕ, end-to-end:
#   ✅ ТЗ КЭ v1.1 (16.05.2026, 6 решений зафиксированы)
#   ✅ КЭ.1 (d46f53a) — lib/photo-transform/ + 33 unit теста
#   ✅ КЭ.2 (7490a4a) — AlbumSpreadCanvas.PhotoSlot использует computeCrop
#   ✅ КЭ.3 (6873c3e) — POST /api/layout?action=update_data endpoint
#   ✅ КЭ.4 (62344b5) — PhotoTransformPanel компонент UI
#   ✅ КЭ.5 (089c8af) — интеграция Panel в LayoutEditorPage
#   ✅ КЭ.6 (1e03011) — '⚙' бейдж 'Кадрирован вручную'
#   ✅ КЭ.7 (3619e8f) — PDF-экспорт уважает __scale__ / __offset__
#   ✅ КЭ.8 — контекст v71 (текущий)
#
# Р.2 + Р.3 (20.05.2026) — расширение контент-редактора:
#   ✅ Р.2 (15a3303) — поворот фото внутри рамки (горизонт ±45° step 0.5°).
#      Новый служебный ключ __rotate__<label>. Auto-zoom factor
#      покрывает рамку без видимого фона по углам. Konva через
#      Group+clipFunc+KonvaImage rotation. PDF через sharp.rotate
#      между extract и финальным cover-resize. Slider добавлен в
#      PhotoTransformPanel третьим контролом.
#   ✅ Р.3 (b4bcb88) — override размера (мультипликатор 50–200%) и
#      цвета (палитра 10 цветов) текста. Новые ключи
#      __fontSize__<label> и __color__<label>. Новый модуль
#      lib/text-style (28 unit-тестов). Новый компонент TextStylePanel
#      (slider размера + цветовые swatch'и) открывается параллельно
#      с TextInlineEditor. PDF text-shaping учитывает override и в
#      shapeText (с min_size), и в цвете.
#
# Хранение transform в album_layouts.spreads[].data:
#   __scale__<label>    = '1.0' .. '2.0'      (default 1.0 = baseline cover)
#   __offset__<label>   = 'x,y' где x,y в [-1, 1]  (default 0,0 = центр)
#   __rotate__<label>   = '-45' .. '45' (градусы, Р.2; default 0 = без поворота)
#   __fontSize__<label> = '0.5' .. '2.0' (мультипликатор, Р.3; default 1.0)
#   __color__<label>    = '#RRGGBB' (HEX, Р.3; default null = placeholder.color)
# Семантика как у существующих __hidden__/__pos__ ключей. Обратная
# совместимость 100% — все альбомы без transform-ключей рендерятся точно
# так же как раньше (regression-safe fast path в sharp).
#
# Р.1 (45776ed, 20.05.2026) — умное автозаполнение при смене мастера.
# Каскад EXACT → NORMALIZED → BY_TYPE в lib/template-replace (26 тестов).
# Все content-ключи (__scale__/__offset__/__rotate__/__fontSize__/
# __color__) мигрируют вместе с label при смене мастера. Балансировочные
# (__hidden__/__pos__) отбрасываются — привязаны к рамкам старого мастера.
#
# 📍 КАК ПРОБОВАТЬ КОНТЕНТ-РЕДАКТОР НА ЖИВОМ АЛЬБОМЕ:
#   1. Открой любой собранный альбом → 'Открыть редактор'
#   2. Клик левой кнопкой по любому фото (одиночный, не drag)
#   3. Появится inline popover 'Кадрирование'
#   4. Меняй slider масштаба (100..200%) или drag туда-сюда точку
#      в touchpad — canvas обновляется realtime
#   5. Для точной правки — два numeric input X/Y под touchpad'ом
#   6. Готово / Esc / клик вне — закрытие
#   7. Через 2с авто-сохранение (Save indicator показывает 'Сохранено')
#   8. На фото с кастомным crop появляется '⚙' бейдж в углу
#   9. Эксп��рт PDF — те же crop попадают в финальный файл
#  10. 'Сбросить' в panel — удаляет ключи __scale__/__offset__,
#      фото возвращается к default cover
#
# 🎯 ЧТО ДАЛЬШЕ — ПРИОРИТЕТЫ ПОСЛЕ РЭ.21.8 (стратегическая сессия 20.05.2026)
#
# Все главные технические блокеры закрыты в проде:
#   ✅ Rule engine + Content-editor + Balance — работают end-to-end
#   ✅ Section Structure engine с эталонной таблицей OkeyBook — closed in
#      РЭ.21.8 (20.05.2026, 7 коммитов, 379/379 тестов)
#   ✅ UI редактор пресетов /super/presets — суперадмин может настраивать
#      все 7 глобальных пресетов без SQL
#   ✅ Семантический поиск мастера ученика — задел для расширения партнёров
#   ✅ Чистка движка 2 (РЭ.21.8.чистка-1, коммит 9124a96) — было 3 движка,
#      стало 2. Карта чище для большой фазы РЭ.22.
#
# ════════════════════════════════════════════════════════════════════════
# СТРАТЕГИЧЕСКАЯ КАРТА (по словам Сергея 20.05.2026):
# ════════════════════════════════════════════════════════════════════════
#
# Главная цель: сделать сервис сильным, рабочим, конкурентоспособным.
# Текущий статус: вся команда OkeyBook работает в InDesign, система
# используется только для отбора фотографий. Запуск партнёров планируется
# на ~3 месяца вперёд (август-сентябрь 2026).
#
# Конструктор пресетов (РЭ.22) — ФУНДАМЕНТ системы. Партнёры (и сам
# OkeyBook) смогут описывать структуру альбома без правок в коде —
# любой "интересный запрос клиента" превращается в "недостающий мастер
# с конкретными слот-тегами", который рисуется в InDesign и автоматически
# подхватывается engine'ом.
#
# ─── Озвученные Сергеем доработки (по его приоритету) ─────────────────
#
#   1. РЭ.22 — Конструктор пресетов (главный приоритет, фундамент)
#   2. ✅ Доработка редактора (шрифты, горизонт, автозаполнение) — закрыта
#      20.05.2026 в коммитах 45776ed (Р.1), 15a3303 (Р.2), b4bcb88 (Р.3)
#   3. AI-улучшение текстов (попозже — сейчас работают цитаты/самостоятельно)
#   4. Экспорт PDF в типографию + сжатый JPEG/PDF для клиента
#   5. Поддержка дизайнов с подложкой (детсады, разные фоны на разделы)
#   6. Превью личной страницы клиенту сразу после выбора фото
#   7. Авто-ретушь (позже)
#   8. Переезд с Vercel (актуально, но не сейчас)
#   9. Биллинг (на потом)
#
# ════════════════════════════════════════════════════════════════════════
# СОГЛАСОВАННЫЙ ПОРЯДОК СЕССИЙ:
# ════════════════════════════════════════════════════════════════════════
#
# Перед стартом большой фазы РЭ.22 — две короткие сессии для расчистки:
#
# ─── ✅ Сессия 1 (СДЕЛАНО, коммит 9124a96, 20.05.2026) ─────────────
#   Удалить движок 2 (buildFromRules). Чистка карты.
#
# ─── ✅ Сессия 2 (СДЕЛАНО, 20.05.2026) — Доработка редактора ───────
#   Закрыта в 4 коммитах:
#     ✅ 45776ed — Р.1: умное автозаполнение при смене мастера.
#        Каскад EXACT → NORMALIZED (lowercase + non-alphanumeric) →
#        BY_TYPE. Новый модуль lib/template-replace + 26 unit-тестов.
#        Content-ключи (__scale__/__offset__/__rotate__/__fontSize__/
#        __color__) мигрируют вместе с label. Балансировочные
#        (__hidden__/__pos__) отбрасываются. Confirm только при
#        реальной потере данных (stats.lost > 0).
#     ✅ 15a3303 — Р.2: поворот фото ±45° (горизонт).
#        Новый служебный ключ __rotate__<label>. В lib/photo-transform
#        добавлены ROTATE_MIN/MAX, parseRotate, serializeRotate,
#        computeAutoZoomForRotation. Auto-zoom factor =
#        |cos θ| + max(W/H, H/W)*|sin θ| — гарантирует полное
#        покрытие рамки повёрнутой картинкой без видимого фона.
#        В Konva PhotoSlot — Group + clipFunc + KonvaImage с rotation.
#        В PDF (sharp) — ROTATE PATH третьей веткой обработки:
#        extract enlarged → resize → rotate → cover-resize centre.
#        PhotoTransformPanel получил третий контрол (slider ±45°
#        step 0.5°, двойной клик на label = сброс только поворота).
#        +15 тестов photo-transform (всего 48/48).
#     ✅ b4bcb88 — Р.3: override размера и цвета шрифта.
#        Новые ключи __fontSize__<label> (мультипликатор 0.5–2.0) и
#        __color__<label> (нормализованный HEX). Мультипликатор, а
#        не абсолют — корректно мигрирует при смене мастера. Новый
#        модуль lib/text-style (parseFontSizeMult, parseColor,
#        TEXT_STYLE_PALETTE — 10 цветов: 4 ахроматических + 6
#        классических для выпускных). Новый компонент TextStylePanel
#        (slider 50–200% step 5% + 10 swatch'ей в grid-cols-5)
#        открывается одновременно с TextInlineEditor. AlbumSpreadCanvas
#        TextSlot/TextInlineEditor принимают fontSizeMult/colorOverride.
#        В PDF text-shaping расширен optional fontSizeMult/colorOverride
#        — учитывается и в shapeText (с min_size), и в цвете. 28
#        новых тестов text-style.
#     ✅ (этот коммит) — docs: контекст v90.
#
#   Итог: 316/316 unit-тестов passing, tsc + next build зелёные,
#   все 4 коммита запушены на main. Регрессий нет — все новые поля
#   опциональные, fast path для default значений сохранён байт-в-байт.
#
# ─── Фаза РЭ.22 — Конструктор пресетов (В РАБОТЕ с 20.05.2026) ──────
#   ✅ РЭ.22.0 (коммит de27d00) — docs/phase-Р22-spec.md v1.0
#      Полная спецификация фазы (564 строки). Все 10 архитектурных
#      развилок зафиксированы. Двух-осевая модель утверждена.
#
#   ✅ РЭ.22.1 (коммит 8516419) — миграция БД.
#      migrations/2026-05-20-presets-student-layout-mode.sql
#      Добавлены student_layout_mode TEXT + student_grid_size INT
#      с двумя CHECK через DO-блоки. ✅ Применена в Supabase 20.05.2026.
#
#   ✅ РЭ.22.2 (коммит 335f00e) — типы + API.
#      - Preset interface расширен (lib/rule-engine/types.ts +
#        PresetEditorModal.tsx)
#      - SELECT в rule_presets_list расширен новыми колонками
#      - Валидация body в rule_preset_update (student_layout_mode enum
#        + student_grid_size int 2..12)
#      - Попутно закрыт скрытый баг РЭ.21.8.15: presetRowToPreset не
#        пробрасывал student_* поля → buildOnePerSpreadAdaptive фактически
#        не активировался в проде. Теперь и legacy и новые поля
#        пробрасываются.
#
#   ✅ РЭ.22.3 (коммит 4d132ec) — UI двух-осевая модель.
#      - Главный селект 'Режим' (page/spread/grid) в PresetEditorModal
#      - Conditional параметры зависят от режима (friend_photos для
#        page/spread, grid_size для grid, has_quote для всех)
#      - Fallback computeInitialLayoutMode/computeInitialGridSize при
#        первом открытии legacy-записи. Amber-warning видим до Save.
#      - Save пишет новые поля + дублирует в legacy (mode=page→pages=1,
#        spread→2, grid→NULL). friend_photos/grid_size записываются
#        только для своего режима.
#
#   ✅ РЭ.22.4 (коммит a554a68) — engine semantic для mode='page'.
#      - В fillStudentsSection приоритетная ветка: student_layout_mode='page'
#        → buildPageSemantic через findStudentMaster.
#      - Семантический выбор: pageRole='student_left'/'student_right',
#        photos_friend, has_quote, has_portrait=true.
#      - Position alternation по чётности pageInstances.length (корректно
#        работает после нечётной soft_intro).
#      - Warning students_master_not_found со спецификацией недостающих
#        slot_capacity-тегов.
#      - Warning students_lost_photos при ближайшем меньшем по photos_friend.
#      - Fallback на legacy buildAlternatingLR когда mode=NULL.
#      - 8 новых тестов sections-students-page-semantic.test.ts.
#      - 324/324 vitest passing.
#
#   ✅ РЭ.22.5 (коммит 7e6ac50) — engine semantic для mode='spread'.
#      - В fillStudentsSection вторая приоритетная ветка:
#        student_layout_mode='spread' → buildSpreadSemantic.
#      - FIXED модель: один и тот же мастер для всех учеников,
#        photos_friend берётся из preset (не из ученика).
#      - Левая страница: pageRole='student_left', photos_friend=0,
#        hasPortrait=true. Правая: pageRole='student_right',
#        photos_friend=preset.student_friend_photos, hasQuote=preset.has_quote.
#      - ⚠️ FIXED vs per-student-ADAPTIVE (buildOnePerSpreadAdaptive для
#        Individual): чтобы сохранить per-student адаптивность, Individual
#        должен оставаться в legacy-пути (mode=NULL + preset.id='individual').
#        UI РЭ.22.3 в initial state показывает mode='spread' для Individual,
#        но в БД пишет NULL до явного Save — старая логика работает до
#        намеренной миграции.
#      - 7 новых тестов sections-students-spread-semantic.test.ts.
#      - 331/331 vitest passing.
#
#   ✅ РЭ.22.6.0 (коммит 5cbd51a) — data-миграция grid-мастеров.
#      migrations/2026-05-20-okeybook-grid-master-tags.sql:
#      UPDATE для M-Grid-Page, L-Grid-Page, L-Grid-12, N-Grid-Page,
#      M/L/N-Combined-Page → page_role='student_grid', slot_capacity
#      вычисляется ДИНАМИЧЕСКИ через jsonb_array_elements по реальным
#      placeholder'ам мастера. Адаптивные мастера L-2/3/4, N-4/6/9
#      в БД отсутствуют — будут размечены отдельно когда дизайнер
#      их нарисует.
#      ✅ Применена в Supabase 20.05.2026. Результаты:
#         M-Grid: students=4, has_quote=true
#         M-Combined: students=2, photos_full=1, has_quote=true
#         L-Grid-Page: students=6, has_quote=false
#         L-Grid-12: students=12, has_quote=false (альтернатива N-Grid)
#         L-Combined: students=3, photos_full=1, has_quote=false
#         N-Grid: students=12, has_quote=false
#         N-Combined: students=4, photos_full=1, has_quote=false
#
#   ✅ РЭ.22.6 (коммит 1c993ee) — engine semantic для mode='grid'.
#      - В master-finder.ts: новая findStudentGridMaster с режимами
#        match='exact' (base) / 'min_fit' (хвост, combined). Опциональный
#        photos_full фильтр. student_grid принимается как fallback для
#        student_grid_left/right.
#      - В sections/students.ts: новая buildGridSemantic — base через
#        точное совпадение students=preset.student_grid_size, затем
#        combined-tail / adaptive-tail / null-padding fallback.
#      - 10 новых тестов sections-students-grid-semantic.test.ts.
#      - 341/341 vitest passing.
#
#   🎉 Students секция полностью переведена на семантический поиск:
#      - mode='page'   — ✅ РЭ.22.4
#      - mode='spread' — ✅ РЭ.22.5
#      - mode='grid'   — ✅ РЭ.22.6
#
#   ✅ РЭ.22.7.1 (коммит fea1a75) — data-миграция teachers-мастеров.
#      migrations/2026-05-20-okeybook-teacher-master-tags.sql:
#      F-Head-LargeGrid/SmallGrid/WithPhoto/WithClassPhoto-L → 'teacher_left'
#      G-FullClass/HalfClass/Teachers-3x3/3x4/4x4 → 'teacher_right'
#      slot_capacity вычисляется динамически через jsonb_array_elements
#      (head_teacher, teachers, photos_full, photos_half).
#      ✅ Применена в Supabase 20.05.2026.
#
#   ✅ РЭ.22.7.2 (коммит 8d91953) — engine teachers семантический.
#      - В master-finder.ts: новая findTeacherMaster с match='exact'/'min_fit'
#        по teachers + точные фильтры head_teacher / photos_full / photos_half.
#      - В sections/teachers.ts: pickLeftMaster и pickRightMaster через
#        resolveTeacherMaster (семантика → legacy fallback по имени →
#        warning со спецификацией). photos_full=0 в левых запросах отсеивает
#        F-Head-WithClassPhoto-L (его задействуем в будущей оптимизации).
#      - LeftChoice и RightChoice теперь хранят SpreadTemplate напрямую +
#        флаг semantic.
#      - decision_trace.inputs.semantic для отладки (true/false).
#      - Закрыт скрытый баг #3: legacy искал 'G-Teachers-4x3', в БД
#        'G-Teachers-3x4'. После семантики имя не важно — engine ищет
#        teachers>=10.
#      - 8 новых тестов sections-teachers-semantic.test.ts.
#      - 349/349 vitest passing.
#
#   🎉 Teachers секция полностью переведена на семантический поиск.
#
#   ✅ РЭ.22.8.1 (коммит 6039415 + фикс 5187361) — data-миграция soft-мастеров.
#      migrations/2026-05-20-okeybook-soft-master-tags.sql:
#      S-Intro → page_role='intro', S-Final-Soft-L → page_role='final'.
#      photos_full вычисляется динамически (=1 у обоих).
#      ⚠️ При первом применении вылез баг #4: CHECK constraint
#         spread_templates_page_role_check не содержал 'final'.
#         Фикс 5187361: ALTER TABLE DROP/ADD constraint с расширенным
#         списком, теперь полный список включает 'intro' + 'final'.
#      ✅ Применена в Supabase 20.05.2026 (после фикса).
#
#   ✅ РЭ.22.8.2 (коммит a4c1d51) — engine soft семантический.
#      - PageRole TS-тип расширен 'final' для синхронизации с БД.
#      - Новая findSoftSectionMaster в master-finder.ts — простой
#        first-match по page_role + опц. photos_full.
#      - sections/soft-intro.ts: семантика(intro, photos_full=1) →
#        legacy fallback 'S-Intro'.
#      - sections/soft-final.ts: семантика(final, photos_full=1) →
#        legacy fallback 'S-Final' → 'S-Final-Soft-L'.
#      - decision_trace.rule_id с реальным именем найденного мастера,
#        inputs.semantic = true/false для отладки.
#      - 11 новых тестов sections-soft-semantic.test.ts.
#      - 360/360 vitest passing.
#
#   🎉 Все 4 секции engine переведены на семантический поиск:
#      students (3 режима) + teachers + soft_intro + soft_final.
#      Партнёр в /super/presets указывает параметры, engine ищет в
#      template_set мастер по тегам page_role + slot_capacity.
#      Имена мастеров (S-Intro, F-Head-WithPhoto, M-Grid-Page и т.д.)
#      больше не имеют значения для engine — только теги.
#
#   ⏭️  РЭ.22.9 — ПРОПУЩЕНА. Идея «диагностики после выбора» заменена
#      на новую фазу РЭ.23 («прорастание template_set в форму»):
#      UI должен предлагать только варианты для которых нарисованы
#      мастера. Это другая архитектура, требует собственного spec.
#
#   ✅ РЭ.22.10 (коммит bf3424a) — summary фазы.
#      docs/phase-Р22-summary.md (158 строк) — финальный документ.
#      Метрики, скрытые баги, состояние engine после фазы, файлы,
#      что не сделано намеренно, ссылка на РЭ.23.
#
#   🏁 ФАЗА РЭ.22 ЗАКРЫТА.
#
#   Полный план (10 подэтапов, все ✅ кроме осознанно пропущенного 9):
#     ✅ РЭ.22.1   — миграция БД (student_layout_mode + student_grid_size)
#     ✅ РЭ.22.2   — типы (Preset) + API валидация
#     ✅ РЭ.22.3   — UI: двух-осевая модель
#     ✅ РЭ.22.4   — engine semantic для mode='page'
#     ✅ РЭ.22.5   — engine semantic для mode='spread'
#     ✅ РЭ.22.6.0 — data-миграция grid-мастеров
#     ✅ РЭ.22.6   — engine semantic для mode='grid'
#     ✅ РЭ.22.7.1 — data-миграция teachers-мастеров
#     ✅ РЭ.22.7.2 — engine teachers семантический
#     ✅ РЭ.22.8.1 — data-миграция soft-мастеров (+ fix CHECK constraint)
#     ✅ РЭ.22.8.2 — engine soft семантический
#     ⏭️  РЭ.22.9  — пропущен, заменён фазой РЭ.23
#     ✅ РЭ.22.10  — summary, закрытие фазы
#
#   Скоуп РЭ.22 (не входит):
#   - common_required / common_additional / transition — уже работают,
#     не трогаем
#   - партнёрский UI редактор пресетов в /app — отдельная сессия
#   - удаление deprecated student_pages_per_student/friend_photos/has_quote
#     — отдельная сессия с двойным подтверждением необратимости
#
#   Объём: 10 коммитов, 2-3 недели.
#
# Архитектурные решения (зафиксированы 20.05.2026):
#   - common_required / common_additional / transition — оставить как
#     есть (уже работают через таблицу OkeyBook)
#   - teachers — переработать на семантический поиск (РЭ.22.7)
#   - students — переработать полностью (РЭ.22.1..РЭ.22.6, основная часть)
#   - soft_intro / soft_final — переработать семантически (РЭ.22.8)
#   - Все 10 развилок РЭ.22 решены, см. docs/phase-Р22-spec.md §11
#
# ─── Уровень 2 (после РЭ.22) ────────────────────────────────────────
#   После того как РЭ.22 закрыт, в любом порядке:
#
#   - AI-улучшение текстов: 4 типа текстов (цитата ученика, его «о себе»,
#     учитель, ответственный родитель) × 3 возраста (старшая школа,
#     началка, детсад) с разными промптами. Объём текста ~200-500 знаков.
#     Кнопка «Улучшить» рядом с textarea. Партнёр видит «оригинал →
#     улучшенный», принимает/отклоняет.
#     Объём: 3-4 коммита.
#
#   - Экспорт PDF для типографии + сжатый для клиента. Большая фаза —
#     сейчас вся команда работает через InDesign, экспорт из системы
#     не делается. Нужно: пресеты типографий (Сергей пришлёт техтребования
#     ещё раз), выноски, цветовой профиль. Тип. → полный PDF для печати,
#     клиент → сжатый JPEG/PDF для просмотра.
#     Объём: 2-3 недели работы, 5-8 коммитов.
#     Это переломный момент — после этого команда сможет работать
#     полностью через систему, без InDesign.
#
#   - Поддержка дизайнов с подложкой: разные фоны на разные разделы
#     (особенно актуально для детсадов). Расширение template_set +
#     изменения в Canvas/PDF рендере.
#     Объём: 3-5 коммитов.
#
#   - Превью личной страницы клиенту сразу после выбора фото —
#     для согласования до отправки в работу.
#     Объём: 2-3 коммита.
#
#   - Левая сторона переходной (РЭ.21.8.11b) — 9 комбо-мастеров от
#     дизайнера. См. master-cleanup-tz.md раздел H.
#
#   - UX/UI шлифовка PresetEditorModal: drag-and-drop секций,
#     создание/удаление/дублирование пресетов, иконки.
#     Объём: 1-2 коммита.
#
# ─── Уровень 3 (на потом) ───────────────────────────────────────────
#   - Авто-ретушь
#   - Переезд с Vercel → Timeweb / YC App Platform
#   - Биллинг
#
# Стратегическое направление (Сергей, 20.05.2026):
#   Не запускать партнёров пока система не отшлифована полностью.
#   Сейчас система используется только OkeyBook + сотрудниками для
#   отбора фото (фаза «внутреннего тестирования»). Когда РЭ.22 +
#   редактор + экспорт PDF будут готовы — Сергей передаст полный тест
#   своему сотруднику, потом запуск партнёров (~август-сентябрь 2026).
#
# ────────────────────────────────────────────────────────────────────────
#
# 📍 КАК НАЧАТЬ СЛЕДУЮЩУЮ СЕССИЮ:
#   1. cd ~/yearbook-v2 && git pull
#   2. ls yearbook-context-v*.md | sort -V | tail -1  → должен показать v111
#   3. ОБЯЗАТЕЛЬНО прочитать:
#      • Шапка v111 — что закрыто (РЭ.24.0..24.3)
#      • docs/phase-Р24-spec.md v1.0
#      • lib/presets/validate.ts + preview-bundle.ts — готовые утилиты
#      • app/api/tenant/route.ts — образец как делать tenant-aware actions
#        (особенно rule_preset_update — там tenant-проверка через preset.tenant_id)
#   4. Применены в Supabase: все РЭ.22, РЭ.23.1, РЭ.24.1 ✅
#   5. СЛЕДУЮЩИЙ ПОДЭТАП: РЭ.24.4 — API endpoints.
#      В app/api/tenant/route.ts добавить 5 action'ов:
#
#      a) GET templates_list_global — список глобальных шаблонов
#         для каталога. SELECT FROM presets WHERE tenant_id IS NULL
#         AND is_recommended=true. Для каждого:
#           • validatePreset(preset) → отфильтровать невалидные
#             (с warning в логе)
#           • loadBundle(preset_id) → buildPresetPreviewBundle(bundle)
#             → 4 SVG
#         Возвращает массив:
#           { id, display_name, description, print_type,
#             student_layout_mode, student_grid_size,
#             previews: {students, cover, teachers, soft} }
#         Доступ: любой авторизованный (включая партнёров).
#
#      b) GET templates_list_my — все шаблоны партнёра
#         (tenant_id=auth.tenantId). Для каждого:
#           • validatePreset → флаг valid + errors[]
#           • Если valid → buildPresetPreviewBundle → 4 SVG
#         Возвращает массив с теми же полями + parent_preset_id +
#         valid + errors[].
#         Доступ: только свои (admin/superadmin/photographer но не viewer).
#
#      c) POST template_clone — клонирование глобального в свой
#         tenant_id. Body: { template_id }.
#         Шаги:
#           - SELECT preset WHERE id=template_id AND tenant_id IS NULL
#             → если не найден или это партнёрский — 404
#           - INSERT copy с tenant_id=auth.tenantId, parent_preset_id=
#             template_id, display_name = '${orig} (моя копия)' (или
#             принять кастомное имя из body)
#           - Возврат: { id, display_name }
#         Доступ: admin/superadmin/photographer.
#
#      d) POST template_create_blank — новый шаблон с нуля.
#         Body: { display_name }.
#         INSERT минимальные поля. student_layout_mode=NULL, шаблон
#         сразу невалиден — партнёр доработает через PresetEditorModal.
#         Доступ: admin/superadmin/photographer.
#
#      e) POST template_delete — удаление шаблона партнёра.
#         Body: { template_id }.
#         Шаги:
#           - SELECT preset WHERE id=template_id AND tenant_id=auth.tenantId
#             → если не найден или это глобальный — 404/403
#           - SELECT COUNT(*) FROM albums WHERE preset_id=template_id
#             AND archived=false → если >0 → 409 со списком альбомов
#             { error: 'Шаблон используется в N альбомах', albums: [...] }
#           - DELETE FROM presets
#         Доступ: admin/superadmin (не photographer — он не должен
#         удалять чужие шаблоны если их кто-то добавил).
#
#      Где найти образцы:
#        - tenant-проверка: app/api/tenant/route.ts rule_preset_update
#          (рядом строка 1791)
#        - GET с tenant фильтром: rule_presets_list (стр 615)
#        - INSERT в presets: rule_preset_create (стр 1699)
#        - loadBundle: app/api/album/[id]/build/route.ts или
#          app/api/tenant/route.ts (поиск 'loadBundle')
#      Не трогаем: UI (РЭ.24.5+), engine.
#      Тесты для API в нашем проекте обычно вручную — оставляем.
#      Проверки: tsc + next build + vitest зелёные. Один атомарный коммит.
#   6. Архитектура движков (без изменений с v89):
#      • legacy buildAlbum (работает в проде)
#      • buildFromSectionStructure (для альбомов с
#        section_structure_preset_id) → fallback legacy
#      • Движок 2 buildFromRules УДАЛЁН (коммит 9124a96)
#   7. ЯЗЫК Сергея (важно для тона):
#      • Раздражается когда Claude задаёт мелкие технические вопросы.
#      • Любит маленькие шаги с откатом, не любит большие коммиты.
#      • Не любит когда Claude инициативно усложняет архитектуру.
#      • Спрашивает «что посоветуешь?» — отвечать одной рекомендацией,
#        не списком вариантов.
#      • На «непонятно почему» — объяснять без техно-жаргона.
#      • Принцип «engine описывает что ищет, а не имена мастеров» —
#        зафиксирован 19.05.2026. Не привязываемся к конкретным
#        комплектациям OkeyBook — партнёры могут иметь свои.
#
# ⚠️ АРХИТЕКТУРНОЕ ПРАВИЛО (зафиксировано 18.05.2026):
#   sheet_type — это атомарная настройка АЛЬБОМА, не классификатор пресетов.
#   Один пресет покрывает оба варианта (плотные/мягкие). Колонка
#   presets.sheet_type существует, но при сборке надо читать
#   ФАКТИЧЕСКОЕ значение из альбома (когда РЭ.12 добавит albums.sheet_type),
#   не из пресета. До этого момента — фолбэк на preset.sheet_type.
#
# 📍 КАК ПРОБОВАТЬ КОНТЕНТ-РЕДАКТОР НА ЖИВОМ АЛЬБОМЕ:
#   1. Открой любой собранный альбом → 'Открыть редактор'
#   2. Клик левой кнопкой по любому фото (одиночный, не drag)
#   3. Появится inline popover 'Кадрирование'
#   4. Меняй slider масштаба (100..200%) или drag туда-сюда точку
#      в touchpad — canvas обновляется realtime
#   5. Для точной правки — два numeric input X/Y под touchpad'ом
#   6. Р.2: третий контрол slider 'Поворот' ±45° step 0.5° для исправления
#      горизонта. Двойной клик по label 'Поворот' — сброс только поворота.
#   7. Готово / Esc / клик вне — закрытие
#   8. Через 2с авто-сохранение (Save indicator показывает 'Сохранено')
#   9. На фото с кастомным crop / поворотом появляется '⚙' бейдж в углу
#  10. Экспорт PDF — те же crop + поворот попадают в финальный файл
#  11. 'Сбросить' в panel — удаляет ключи __scale__/__offset__/__rotate__,
#      фото возвращается к default cover
#
# 📍 КАК ПРОБОВАТЬ Р.3 — ШРИФТЫ (размер + цвет):
#   1. Клик по любому тексту в редакторе
#   2. Появляется textarea для редактирования содержимого + рядом
#      TextStylePanel popover
#   3. Slider 'Размер' 50–200% step 5% — мультипликатор от placeholder.font_size_pt
#   4. Палитра 10 цветов (4 ахроматических + 6 классических для выпускных).
#      Клик по swatch'у выбирает цвет, повторный клик по активному — сбрасывает
#      override (возвращается placeholder.color из IDML)
#   5. 'По умолчанию' внизу — сброс обоих параметров (удаляет ключи
#      __fontSize__/__color__)
#   6. 'Готово' / Esc закрывает только панель стилей, textarea остаётся
#      открытой пока пользователь не зафиксирует текст (Enter / клик вне)
#
# 📍 КАК ПРОБОВАТЬ Р.1 — УМНОЕ АВТОЗАПОЛНЕНИЕ ПРИ СМЕНЕ МАСТЕРА:
#   1. В редакторе выбери разворот с заполненными фото и текстом
#   2. Кнопка 'Заменить шаблон' → откроется TemplatePickerModal
#   3. Выбери другой мастер — содержимое старого автоматически разносится
#      в новые слоты по каскаду (EXACT label → NORMALIZED → BY_TYPE)
#   4. Confirm 'X значений не помещаются' появляется ТОЛЬКО если что-то
#      реально потерялось (раньше confirm был всегда даже при ровном переезде)
#   5. Все настройки кадрирования / поворота / стиля шрифта мигрируют
#      вместе с label — не надо заново настраивать после смены мастера
#
# Реалистичная скорость: 2-3 коммита в неделю. Все блоки влезают
# в срок до августа с запасом.
#
# Rule engine ПОЛНОСТЬЮ В ПРОДЕ, end-to-end:
#   ✅ Спецификация v1.3 + 7 семейств + 40 правил + 7 пресетов
#      (РЭ.18.2: +4 правила common-section-*-pair для полноценного раздела)
#   ✅ Алгоритм buildFromRules (РЭ.9, ~1.5K строк)
#   ✅ 104 unit tests (РЭ.10 + РЭ.16.2 + РЭ.18.2)
#   ✅ Sandbox endpoint + UI Build Test в /super/templates (РЭ.13)
#   ✅ Preview endpoint + UI кнопка в AlbumDetailModal (РЭ.14)
#   ✅ Singleton-fix + warnings cleanup (РЭ.15)
#   ✅ albums.rules_preset_id миграция + handleBuildAlbum развилка +
#      UI селектор движка сборки (РЭ.16)
#   ✅ Адаптер 1:N — каждая страница отдельный legacy SpreadInstance (РЭ.17)
#   ✅ Полноценный общий раздел + common_section_max_spreads (РЭ.18)
#
# 📍 КАК ВКЛЮЧИТЬ RULE ENGINE НА АЛЬБОМЕ (НАПОМИНАНИЕ):
#   1. Один раз: applied миграции из migrations/
#      2026-05-16-albums-rules-preset-id.sql ✅
#      2026-05-18-presets-total-pages-density-sheet-type.sql ✅ (РЭ.20.2)
#      2026-05-18-presets-density-sheet-type-values.sql ⏳ (РЭ.20.5)
#      2026-05-18-rollback-mini-hard.sql ⏳ (удаляет лишний пресет)
#   2. Залить правила/пресеты (ПОСЛЕ КАЖДОГО ИЗМЕНЕНИЯ ПРАВИЛ В РЕПО):
#      npx tsx --env-file=.env.local scripts/seed-rule-engine.ts --write
#      Должно вывести '7 families, 40 rules, 7 presets UPSERTed'.
#   3. Альбом → вкладка Обзор → dropdown '🧪 Движок сборки' → выбрать
#      'Rule Engine: <preset>' → Пересобрать
#
# 📍 РЕАЛЬНЫЕ ПРОВЕРКИ 16.05.2026 (Сергей):
#   ✅ 'тест 2026' × universal (8 students, 1 subject, 10 fc+9 hc+30 sx):
#      - 1 учительский разворот F-Head-SmallGrid + G-HalfClass
#      - 4 разворота пар учеников E-Universal-Left + E-Universal-Right
#      - 5 разворотов full_class общего раздела J-ClassPhoto + J-ClassPhoto-Right
#      - 1 разворот half_class общего раздела J-Half pair
#      - 2 разворота sixth общего раздела J-Collage pair
#      = 13 разворотов, status=ok, общий раздел заполнен
#   ✅ 'тест 2026' × medium: layout успешно собран, медиум grid отрисован
#   ✅ 'Школа 89' × mini-soft (30 students): overflow + grid-tail + S-Final-Soft
# ✅ Миграция rule-engine-migration.sql применена в Supabase 16.05.2026.
# ✅ IDML v2 загружен через convert-idml.ts: template_set okeybook-default
#    (id=08baf556-7831-44e9-9ba8-4af20f19ee44) с 30 мастерами в БД.
# ✅ 7 семейств UPSERTнуты в template_families.
# ✅ 36 правил написаны в docs/rule-engine-data/rules/{family}/*.json,
#    все валидны (Zod-схема + ссылочная целостность).
# ✅ РЭ.8: scripts/seed-rule-engine.ts --write UPSERTит families + rules + presets.
# ✅ РЭ.9 (16.05.2026 — 5 коммитов 561bb78..8bd76eb):
#    lib/rule-engine/ полностью реализован — buildFromRules алгоритм работает.
#    Файлы:
#      evaluate.ts   — Pratt-парсер выражений БЕЗ Function/eval,
#                      evaluateWhen покрывает все 14 операторов §7.2
#      apply.ts      — applyRule: обработка produces (spread/page/sequence-stub)
#                      + развёртка параметрических bind-шаблонов
#      balance.ts    — applyBalance: placeholder_centering через существующий
#                      balanceRegularGrid + hide_unfilled через __hidden__<label>
#      loaders.ts    — loadBundle: preset+rules+families+template_set из Supabase
#      build.ts      — buildFromRules чистая синхронная функция, НЕ бросает,
#                      decision_trace заполняется per правило, status='ok|partial|failed'
#    Интеграция:
#      lib/album-builder/index.ts реэкспортирует buildFromRules, loadBundle,
#      типы AlbumLayout/RulesAlbumInput и т.д.
#      Добавлена обёртка buildAlbumOrFallback(opts) → EngineBuildResult:
#        - { engine: 'rules', layout, rules_warnings }
#        - { engine: 'legacy', result, fallback_reason? }
#      Фолбэк автоматический: при исключении или status='failed' — legacy buildAlbum.
#      Status='partial' (есть warnings но layout валиден) НЕ триггерит фолбэк.
#    Места вызова buildAlbum в коде НЕ затронуты — это новая точка входа для
#    постепенной миграции в РЭ.13.
# ✅ РЭ.10 (16.05.2026 — 5 коммитов 5988fa5..ХХХХХ):
#    vitest setup (vitest ^4.1.6 + @vitest/coverage-v8) + 77 unit tests.
#    Файлы тестов:
#      __tests__/evaluate.test.ts         — 32 теста (РЭ.10.1)
#      __tests__/apply.test.ts            — 12 тестов (РЭ.10.2)
#      __tests__/balance.test.ts          — 9 тестов  (РЭ.10.3)
#      __tests__/build.test.ts            — 10 тестов smoke (РЭ.10.4)
#      __tests__/build-edge.test.ts       — 14 тестов edge cases (РЭ.10.5)
#    Фикстуры:
#      __tests__/__fixtures__/masters.ts  — 25 минимальных SpreadTemplate
#                                            для всех мастеров из правил
#      __tests__/__fixtures__/bundle.ts   — loadTestFamilies/Rules/Presets
#                                            из реальных docs/rule-engine-data/
#    Скрипты в package.json:
#      'test'          → vitest run
#      'test:watch'    → vitest
#      'test:coverage' → vitest run --coverage
#    Найден и пофикшен баг в apply.ts: master_selector_params не
#    обновлялся после резолвинга в число (тест 'parametric L-Grid-Page').
#    Все 77 тестов проходят за 132ms.
# Следующий шаг: РЭ.11 (TemplatePickerModal фильтрация по family_id —
# UI задача для редактора).
#
# СОСТОЯНИЕ ФАЗ 15.05.2026:
# ✓ А (А.1+А.2+А.3+А.4) — общий раздел + виньетки + UI (17 коммитов, 11.05.2026)
# ✓ Б минимум — оригиналы для печати (5 коммитов, 11.05.2026)
# ✓ В — cleanup + YC статистика виджет (3 коммита, 11.05.2026)
# ✓ К — workflow цветокора и ретуши (5 коммитов К.1-К.5 + К.7, 12.05.2026)
# ✓ П — UX загрузки оригиналов (1 коммит, 12.05.2026)
# ✓ Л — редактор макета (10 коммитов Л.0-Л.5 + 3 swap-фикса, 12.05.2026)
# ✓ М — структурное редактирование (3 коммита М.1-М.3, 12.05.2026 вечер)
# ✓ Техдолг #4 + #5 + bulk-догрузка + UX-фиксы (5 коммитов, 12.05.2026 вечер)
# 📐 RULE ENGINE — спецификация v1.1 написана (15.05.2026, 2 коммита docs).
#    Подэтапы РЭ.1-РЭ.10 + РЭ.13..РЭ.18 ✅ выполнены.
#    Rule engine ПОЛНОСТЬЮ ENDED-TO-END В БОЕВОМ ПРОДЕ.
#    РЭ.11 (UI фильтр picker'а) + РЭ.12 (UI редактор пресетов) — отложены.
# 🎨 КОНТЕНТ-РЕДАКТОР ФОТО (КЭ) — ✅ ЗАКРЫТА 16.05.2026 (8 коммитов).
#    Партнёр может крутить scale + offset фото в редакторе как в InDesign.
#    Изменения сохраняются как __scale__<label>/__offset__<label> в data.
#    Применяется в Konva preview и в PDF-экспорте через единую функцию
#    computeCrop из lib/photo-transform/. 33 unit-теста.
# 🎨 ДОРАБОТКА РЕДАКТОРА (Р.1+Р.2+Р.3) — ✅ ЗАКРЫТА 20.05.2026 (3 коммита):
#    • Р.1 (45776ed) — умное автозаполнение при смене мастера
#    • Р.2 (15a3303) — поворот фото ±45° (__rotate__<label>)
#    • Р.3 (b4bcb88) — override размера и цвета шрифта (__fontSize__, __color__)
#    +69 unit-тестов суммарно (template-replace, photo-transform, text-style).
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
# 🆕 ЧТО НОВОГО В v57 ОТНОСИТЕЛЬНО v56
#
# ────────────────────────────────────────────────────────────────────
# 📐 RULE ENGINE — СПЕЦИФИКАЦИЯ v1.1 (15.05.2026, после ревью с Сергеем)
# ────────────────────────────────────────────────────────────────────
#
# Контекст: текущий `lib/album-builder/` (3139 строк, монолитная
# реализация `buildAlbum`) трудно расширяемая — каждое правило вёрстки
# зашито в TypeScript switch. Партнёр в кабинете не видит почему
# алгоритм выбрал именно такой мастер. Меняем на rule engine — те же
# правила, но как ДАННЫЕ в БД (JSON), не как код.
#
# Подготовка v57:
#   ✓ docs/templates/architecture-decisions-2026-05-15.md (12 решений)
#     — 3-уровневая модель, density param, постраничные мастера,
#     версионирование, совместимость со старым buildAlbum
#   ✓ docs/templates/composition-catalog.md + xlsx (заполнен Сергеем
#     14-15.05) — каталог всех вариаций композиций которые система
#     должна уметь верстать
#   ✓ docs/rule-engine-spec.md v1.3 (16.05.2026) — после IDML v2
#     Combined уточнены: M=2/L=3/N=4 (не «обрезанная полная сетка»)
#   • docs/rule-engine-spec.md v1.2 (16.05.2026) — для истории
#   • docs/rule-engine-spec.md v1.1 (7f3647f, 15.05.2026) — для истории
#     — полная спецификация: 13 разделов + 2 приложения
#
# 3 ПРАВКИ v1.2 → v1.3 (после получения IDML v2 16.05.2026):
#   1. Combined — это ОТДЕЛЬНЫЙ продуктовый вид страницы с МЕНЬШИМ
#      числом портретов (M=2, L=3, N=4), не «полная сетка + общее
#      фото внизу». Применяется когда остаток учеников маленький:
#      students_remaining <= MAX_SLOTS_COMBINED[density] + есть
#      общее фото. Иначе → обычный Grid-Page.
#   2. ТЗ дизайнеру v1.4 → v1.5 (designer-tz-2026-05-16-v1.5.md)
#      с правильными размерами Combined.
#   3. Константа MAX_SLOTS_COMBINED = {medium: 2, light: 3, mini: 4}
#      будет в lib/rule-engine/ при реализации РЭ.6.
#
# 11 ПРАВОК v1.1 → v1.2 (после сверки с реальным IDML 16.05.2026):
#   1. Добавлено подсемейство КОМБИНИРОВАННЫХ мастеров:
#      M-Combined-Page (medium), L-Combined-Page (light),
#      N-Combined-Page (mini) — портреты вверху + общее фото
#      внизу НА ОДНОЙ странице. Применяются ТОЛЬКО для density
#      medium/light/mini. Для E-* (max/universal/standard) НЕ нужны.
#   2. spread_templates.params получает флаг has_class_photo_bottom
#      для комбинированных. Алгоритм правил предпочитает их когда
#      students_remaining < capacity И есть общее фото.
#   3. G-HalfClass метки: halfphoto_1, halfphoto_2 (унифицированы
#      с J-Half вместо halfleftphoto/halfrightphoto).
#   4. E-Max: цитата на Right (была на Left), Left только портрет+ФИО.
#   5. E-Universal-Left и -Right: каждая страница — ОТДЕЛЬНЫЙ ученик
#      со своим портретом+ФИО+цитатой+2 фото с друзьями.
#      capacity_per_spread = 2 (две независимые страницы).
#   6. G-Teachers-4x3 → G-Teachers-3x4 (физическая геометрия 3×4).
#   7. J-Quarter → J-Quarter-Left + J-Quarter-Right.
#   8. J-Quote удалён из MVP.
#   9. S-Intro сокращён до classphotoframe (albumtitle/year/school отложены).
#   10. M-Grid-Page получил studentquote_N (у Medium есть цитаты,
#       у Light/Mini нет).
#   11. ТЗ дизайнеру v1.3 → v1.4 (docs/templates/designer-tz-2026-05-16.md).
#
# 13 ПРАВОК v1.0 → v1.1 (после 3 раундов ревью с Сергеем 15.05.2026):
#   1. «Межсемейственный разворот» → «разворот со смешанными
#      страницами». Применяется для любого нечётного числа в Standard
#      и любого неполного заполнения сеток.
#   2. Дублирование данных между секциями — специфика конкретных
#      пресетов (Индивидуальный), не by-default.
#   3. Пресет «Стандарт+виньетка» удалён (моё изобретение).
#   4. I-Personal удалено целиком (функцию выполняет student-section
#      density=maximum).
#   5. Добавлен пресет «Индивидуальный» (реальный пример двух секций
#      student-section: max + mini).
#   6. Трюмо заложено как print_type='tryumo'+pages_per_spread=3.
#   7. has_quote/has_friend_photos/friend_photos_max — параметры
#      секции пресета, не свойства density.
#   8. Добавлена §4.4 — матрица допустимых параметров по плотности.
#   9. Параметрические мастера: заложены ОБА пути (параметрический
#      + N отдельных). Парсер IDML принимает оба формата.
#   10. Добавлен мастер F-Head-WithClassPhoto-L (page-left) + правило
#       t-class-0-classphoto-and-halfs priority=110.
#   11. series_id заложено в БД, NULL по умолчанию.
#   12. Section.params.portrait_source + Student.secondary_portraits[]
#       — опционально для будущей виньетки с детскими садиковыми фото.
#   13. Добавлен §1 «Как это работает простыми словами» — введение
#       без терминов и JSON.
#
# Ключевые архитектурные решения зафиксированные в spec'е:
#
# 1. ТРИ УРОВНЯ:
#    - Мастер (атом, одна страница IDML) → spread_templates
#    - Семейство (правила выбора + заполнения) → template_families + rules
#    - Пресет (комплектация = список секций) → presets
#
# 2. СЕМЬ АКТИВНЫХ СЕМЕЙСТВ (I-Personal удалён в v1.1):
#    head-teacher, subject-teachers, class-photo, student-section,
#    common-section, intro, final.
#    I-Personal удалён целиком — его функцию выполняет student-section
#    с density=maximum в пресете Индивидуальный.
#
# 3. STUDENT-SECTION С ПАРАМЕТРОМ DENSITY (КЛЮЧЕВОЕ):
#    Вместо отдельных семейств E-Standard/E-Universal/E-Maximum/
#    Medium/Light/Mini/Виньетка — ОДНО семейство student-section
#    с параметром density: maximum/universal/standard/medium/light/mini.
#    Виньетка = density=mini (не отдельное семейство).
#    Несколько секций student-section с разными density могут быть
#    в одном пресете — реальный пример "Индивидуальный": сначала
#    density=maximum (по развороту на ученика), затем density=mini
#    (виньетка всех учеников в конце). Дублирование данных в этом
#    пресете — корректное поведение.
#    has_quote, has_friend_photos, friend_photos_max — параметры
#    секции (не свойства density). Матрица допустимости — §4.4 spec'а.
#
# 4. ПОСТРАНИЧНАЯ МОДЕЛЬ + ТИПЫ ПЕЧАТИ:
#    Все мастера postpage (page-left/page-right/page-any/spread).
#    Из 4 одностраничных можно собрать 8 разворотов.
#    print_type: layflat / soft / tryumo (заложено).
#    Трюмо (фотопапка из 3 створок, pages_per_spread=3) заложено
#    структурно в БД, реализация после MVP.
#    series_id (визуальный стиль комплекта) заложено в БД, NULL по
#    умолчанию. Один глобальный комплект okeybook-default в MVP.
#    Открыта дверь для будущих дизайн-серий без миграции.
#
# 5. РАЗВОРОТ СО СМЕШАННЫМИ СТРАНИЦАМИ — первоклассная концепция:
#    Левая страница из одного семейства + правая из другого
#    (student-section слева + common-section справа).
#    Норма для ЛЮБОГО нечётного числа учеников в Standard и
#    ЛЮБОГО неполного заполнения сеток (Light, Medium, Mini).
#    Не редкое исключение — массовое явление. Флаг mixed_pages=true.
#    Также используется для нового мастера F-Head-WithClassPhoto-L
#    (page-left) в паре с G-HalfClass (правая страница).
#
# 6. ПАРАМЕТРИЧЕСКИЕ МАСТЕРА vs N ОТДЕЛЬНЫХ — ОБА ПУТИ:
#    Для Mini (1..12 учеников), Light (1..6), Medium (1..4),
#    G-Teachers (3x3/4x3/4x4) — поддерживаются ДВА пути:
#      Путь А: ОДИН IDML с диапазоном grid_modes (параметрический)
#      Путь Б: N отдельных мастеров (один IDML на каждое число)
#    Парсер IDML принимает оба формата. Какой использовать —
#    продуктовое решение OkeyBook + дизайнера, не архитектурное.
#    Алгоритм: при сборке если есть мастер с params.parametric=true
#    → использует его; иначе → ищет отдельный мастер по slot_count.
#
# 7. VARIANTS — множественные правильные ответы:
#    При subjects=10..12 есть 3 варианта правой страницы (3x3/4x3/4x4).
#    Алгоритм выбирает default по контексту, партнёр в редакторе
#    переключает кнопкой «другая раскладка» (UI готов в фазе М).
#
# 8. БАЛАНСИРОВКА — 3 фазы:
#    Phase 1 (MVP, локальная per-spread) — использует существующий
#    lib/album-builder/balance.ts (393 строки готовы с фазы Б).
#    Phase 2 (после MVP, оптимизация при жалобах партнёров).
#    Phase 3 (UI ручной правки) — уже реализована в фазе М.
#
# 9. СОВМЕСТИМОСТЬ — старый buildAlbum НЕ выбрасываем:
#    Существующие альбомы (50+ в проде) продолжают рендериться через
#    `buildFromMonolithic`. Новые пресеты используют `buildFromRules`.
#    Каждый альбом помнит свою rules_version. Полная миграция
#    НЕ обязательна.
#
# 10. ЦЕЛЬ ПО КОЛИЧЕСТВУ МАСТЕРОВ:
#     ~27 мастеров на одну дизайн-серию (вместо ~80 без rule engine).
#     В 3-4 раза меньше работы дизайнеру.
#
# 11. РЕШЕНИЯ SPEC'А ПО 🔴 СЛУЧАЯМ КАТАЛОГА (см. Приложение А):
#     А.1 T-Class subjects≥9 + общие фото/полкласса → не используются,
#         переходят в common-section. Партнёр может добавить доп.
#         учительский разворот вручную.
#     А.2 S-Intro для layflat → нет (подтверждено Сергеем)
#     А.3 S-Final-Soft-L дефолт → последнее full_class, fallback
#         half_class[0], fallback пустой placeholder
#     А.4 Виньетка → секция student-section с density=mini.
#         В Мини пресете — единственный раздел учеников.
#         В Индивидуальном — после density=maximum.
#         В будущем возможна с детскими фото из садика
#         (portrait_source='secondary_1', заложено в типах).
#     А.5 E-Maximum 4+ фото с друзьями → warning + обрезка до 4
#     А.6 E-Maximum-1 одинокий → не нужен (подтверждено)
#     А.7 Mini 25-30 overflow → простой каскад, не «брать с предыдущей
#         правой страницы» (Phase 2)
#     А.8 Medium 9+ → полные по 8 + остаток с балансировкой
#     А.9 I-Personal → УДАЛЕНО (v1.1). Отдельное семейство не
#         создаётся. Функцию выполняет student-section с
#         density=maximum в пресете Индивидуальный.
#     А.10 Трюмо (v1.1) → print_type='tryumo' + pages_per_spread=3
#         зарезервированы. Реализация после MVP.
#     А.11 Параметрические мастера (v1.1) → ОБА пути в архитектуре
#         (параметрический + N отдельных). Парсер принимает оба.
#     А.12 F-Head-WithClassPhoto-L (v1.1) → новый одностраничный
#         мастер для композиции «классрук + общее фото внизу левой
#         + 2 полкласса справа». В паре с G-HalfClass через правило
#         t-class-0-classphoto-and-halfs (priority=110).
#     А.13 series_id (v1.1) → заложено в БД, NULL по умолчанию.
#         В MVP не используется.
#
# ────────────────────────────────────────────────────────────────────
# ПЛАН РЕАЛИЗАЦИИ RULE ENGINE (для следующих сессий)
# ────────────────────────────────────────────────────────────────────
#
# Подэтапы РЭ.1-РЭ.13 (из rule-engine-spec.md §13):
#
# ✅ РЭ.1  — Миграция БД (e9d2d86, 15.05.2026)
#            template_families, rules, presets, layout_cache (новые таблицы)
#            + ALTER spread_templates (family_id, page_type, series_id,
#              density, params)
#            + ALTER album_layouts (preset_id, rules_version, decision_trace)
#            + ALTER children (secondary_portraits для будущей виньетки
#              с детскими фото — в MVP не используется)
#            ФАЙЛ: rule-engine-migration.sql в корне репо
#            ✅ Сергей применил миграцию в Supabase 16.05.2026.
#
# ✅ РЭ.2  — Типы и Zod-схемы (caafba2, 15.05.2026)
#            lib/rule-engine/types.ts (450 строк) — все типы из spec §7-9
#            lib/rule-engine/schemas.ts (310 строк) — Zod валидация
#            + DENSITY_PARAM_MATRIX константа (§4.4 spec'а)
#            + validateSectionParams() функция-валидатор
#            Установлено: zod ^3.25.76 (использована v3 а не v4 —
#            v4 имеет breaking changes которые не нужны в MVP)
#
# ✅ РЭ.3  — JSON-каталог глобальных данных (e5cbbd4, 15.05.2026)
#            docs/rule-engine-data/families/ — 7 файлов (7 семейств)
#            docs/rule-engine-data/presets/ — 7 файлов:
#              standard, universal, maximum, individual (НОВЫЙ v1.1
#              с двумя секциями student-section), medium, light, mini-soft
#            docs/rule-engine-data/rules/ — пусто (наполняется РЭ.4-РЭ.7)
#            docs/rule-engine-data/README.md — описание структуры
#            scripts/seed-rule-engine.ts — read-only валидация:
#              - проверяет JSON через Zod-схемы
#              - проверяет ссылочную целостность (rules.family_id,
#                presets.sections[].family_id)
#              - валидирует параметры секции по матрице §4.4
#            Запуск: npx tsx scripts/seed-rule-engine.ts
#            Результат текущий: 7/7 семейств + 36/36 правил + 7/7 пресетов OK.
#            UPSERT в Supabase для семейств — добавлен в РЭ.3.5 ниже.
#            UPSERT правил и пресетов — добавлен в РЭ.8 (cd0599b).
#
# ✅ РЭ.3.5 — IDML загрузка с rule engine метаданными (97b8fb8 + 3561b54 +
#            4805301, 16.05.2026). Подэтап добавлен между РЭ.3 и РЭ.4:
#            без него правила в РЭ.4 не смогли бы опереться на корректные
#            family_id / page_type / density / params в spread_templates.
#
#            Что сделано:
#            - lib/idml-converter/family-mapping.ts — таблица 30 мастеров
#              из ТЗ v1.5 → их метаданные rule engine. getFamilyMapping()
#              возвращает family_id, page_type, density, params (с флагом
#              has_class_photo_bottom для Combined).
#            - lib/idml-converter/upload.ts — при INSERT в spread_templates
#              автоматически проставляет 4 новых поля. Если имя мастера
#              неизвестно — console.warn, поля null.
#            - lib/idml-converter/upload.ts — fix update-in-place при --force:
#              вместо delete+insert template_set делаем UPDATE+delete spreads+
#              insert spreads. album_layouts.template_set_id остаётся валидным.
#            - scripts/seed-rule-engine.ts --write — UPSERT 7 семейств в
#              template_families (нужен ДО upload, иначе FK violation).
#            - scripts/convert-idml.ts --dry-run — выводит таблицу
#              "30/30 masters mapped" + family/page_type/density.
#
#            Состояние БД на 16.05.2026 после РЭ.3.5:
#            - template_families: 7 строк (все 7 семейств)
#            - template_sets: okeybook-default (id=08baf556-7831-44e9-9ba8-
#              4af20f19ee44, размер 226×288мм, layflat, global)
#            - spread_templates: 30 строк под okeybook-default,
#              все с family_id, page_type, density (для student-section
#              мастеров), params (parametric=true для Grid+Combined,
#              has_class_photo_bottom=true для Combined)
#
# ✅ РЭ.4  — Правила head-teacher (96c7608, 16.05.2026)
#            13 файлов в docs/rule-engine-data/rules/head-teacher/.
#            Логика выбора F-мастера по subjects_count: 0/1-4/5-8/9/10-12/13-16.
#            Включая t-class-0-classphoto-and-halfs (priority 110)
#            для F-Head-WithClassPhoto-L. Правила subject-teachers и
#            class-photo как отдельные семейства НЕ создавались — они
#            используются как right_master в head-teacher правилах.
#            subjects=9..16: правая страница = G-Teachers-3x3/3x4/4x4
#            без классрука (он на левой через F-Head-WithPhoto).
#            При subjects=9..16 общие фото в common-section, не на
#            учительский разворот.
#
# ✅ РЭ.5  — Правила student-section: maximum/universal/standard (33c9df8)
#            5 файлов: maximum (всегда симметричный разворот E-Max-Left+
#            E-Max-Right даже без фото с друзьями — балансировка скроет),
#            universal pair+tail, standard pair+tail (с одиноким учеником
#            через разворот со смешанными страницами).
#
# ✅ РЭ.6  — Правила student-section: medium/light/mini + Combined (324852c)
#            Первая версия (15 правил) была переделана после ревью Сергея.
#            Финал: 9 правил (по 3 на плотность: overflow + spread-tail +
#            grid-tail) + 3 initial-combined (для изначально малых классов).
#            Combined применяется ТОЛЬКО при current_student_index=0 и
#            students_remaining ≤ MAX_SLOTS_COMBINED, чтобы не создавать
#            Combined с 1-2 портретами после полного разворота.
#            Для остатков после overflow висящая правая → common-section.
#            Стратегия ребалансировки (Light 5+5+3) НЕ реализована —
#            оставлена как UI-функция редактора фаз 2+.
#
# ✅ РЭ.7  — Правила common-section + intro + final (324852c)
#            common-section: 3 правила для заполнения висящей правой
#            страницы. Приоритет J-Half(100) → J-Full(90) → J-Collage-6(80).
#            intro: 1 правило (S-Intro для soft + общее фото).
#            final: 2 правила (S-Final-Soft-L with-photo/text-only).

# ✅ РЭ.8  — seed-rule-engine --write UPSERT правил и пресетов (cd0599b, 16.05.2026)
#            До: --write писал только template_families. Правила и пресеты
#            валидировались, но в БД не попадали.
#            После: --write выполняет три UPSERT по очереди (порядок диктуется FK):
#              1. template_families (как и было) — 7 строк
#              2. rules — 36 правил из docs/rule-engine-data/rules/{family}/*.json
#                 - id/family_id/family_version/priority — плоские колонки
#                 - rule_json — весь объект правила целиком (так buildFromRules
#                   работает с одним полем вместо склейки колонок и JSON)
#                 - tenant_id = null (все правила в репо — глобальные)
#                 - enabled = rule.enabled ?? true
#              3. presets — 7 пресетов из docs/rule-engine-data/presets/*.json
#            Каждый UPSERT — {onConflict: 'id', count: 'exact'} как для семейств.
#            При ошибке любого шага скрипт падает с exit(1), последующие
#            UPSERT не выполняются (предотвращает частичную запись).
#            Read-only валидация и форматы JSON не менялись.
#            Запуск seed --write на боевой Supabase делает Сергей.
#            После него БД содержит: 7 families + 36 rules + 7 presets.
#
# ✅ РЭ.9  — buildFromRules алгоритм (5 коммитов, 16.05.2026):
#            РЭ.9.1 (561bb78) — evaluate.ts (~520 строк):
#              Pratt-парсер выражений БЕЗ Function/eval. evaluateWhen
#              покрывает 14 операторов §7.2. resolveValue/Number/Boolean
#              для bind-выражений. Поддержка путей, {i}, $varname,
#              арифметики/сравнений/логики/тернарного/nullish,
#              функций min/max/select_grid_mode, методов arr.last().
#            РЭ.9.2 (25acca7) — apply.ts (~330 строк):
#              applyRule(rule, ctx, input, cursors, masters) → ProducedResult.
#              Все три типа produces (spread/page/sequence-stub).
#              Конвенции left_master/right_master в bind при одинаковых
#              именах. Развёртка параметрических шаблонов по range
#              (включая динамические границы 'subjects_count',
#              'students_remaining - 6', '$slot_count'). skip_if/expr/
#              template + params. Заполнение null для placeholder'ов
#              мастера которых нет в bind.
#            РЭ.9.3 (7f7eb93) — balance.ts (~150 строк):
#              applyBalance(page, master, clause). placeholder_centering
#              через существующий balanceRegularGrid из album-builder.
#              hide_unfilled через служебные ключи __hidden__<label>='1'
#              и __pos__<label>='X,Y' внутри bindings (тип PageInstance
#              не меняется — миграция album_layouts не нужна).
#            РЭ.9.4 (847b63d) — loaders.ts + build.ts (~460 строк):
#              loadBundle async: preset+rules(priority desc)+families+
#              template_set+mastersByName. buildFromRules чистая
#              синхронная, не бросает. Защиты: HARD_LOOP_LIMIT=200,
#              cursorsChanged check, try/catch fatal → status='failed'.
#              buildContext с prev_spread.right_page_empty для mixed pages.
#              placePages три случая (spread/right→pending/left→pending=true).
#              pickVariant с when_default или first-by-position. mergeVariant
#              наследует family_id+priority у parent.
#            РЭ.9.5 — интеграция в lib/album-builder/index.ts:
#              Реэкспорт buildFromRules, loadBundle, AlbumLayout,
#              RulesAlbumInput, RulesPreset, RuleEngineBundle и т.д.
#              Обёртка buildAlbumOrFallback(opts) → EngineBuildResult
#              дискриминированный union { engine:'rules'|'legacy', ... }.
#              Фолбэк автоматический при исключении или status='failed'.
#              Места вызова buildAlbum НЕ затронуты (новая точка входа).
#            Проверки на каждом коммите: tsc clean + next build green.
#            ⏳ Реальная сборка на боевых данных — в РЭ.13 (API endpoint).
# ✅ РЭ.10 — vitest тесты алгоритма (5 коммитов, 77 тестов, 16.05.2026):
#            РЭ.10.1 (5988fa5) — vitest setup + evaluate.test.ts (32 теста):
#              evaluateWhen все 14 операторов §7.2, resolveValue path
#              (input.X.Y, [\$cursor], арифметика, {i} range_var, .last()),
#              resolveValue expressions (тернарный, !, ??, min/max,
#              арифметика), resolveNumber, resolveBoolean.
#            РЭ.10.2 (2fa8854) — apply.test.ts (12 тестов) + masters fixtures:
#              25 минимальных SpreadTemplate (F/G/E/L/M/N/J/S мастера),
#              type=spread разные/одинаковые мастера, skip_if true/false,
#              parametric master selector, missing master,
#              range с динамическими границами (subjects_count, remaining-6).
#              Попутно пофикшен баг в apply.ts: master_selector_params
#              не обновлялся после резолвинга числа.
#            РЭ.10.3 (b67aad3) — balance.test.ts (9 тестов):
#              hide_unfilled добавляет __hidden__<label>='1',
#              placeholder_centering вызывает balanceRegularGrid для
#              KNOWN_GROUPS, master/clause/placeholders guards.
#            РЭ.10.4 (61f983f) — build.test.ts smoke (10 тестов) +
#              __fixtures__/bundle.ts (loadTestFamilies/Rules/Presets
#              из реальных docs/rule-engine-data/):
#              Стандарт/Универсал/Максимум/Индивидуальный/Мини-soft пресеты,
#              head-teacher для разных subjects_count (1-4, 10-12, 0+halfs),
#              rules_version детерминирован.
#            РЭ.10.5 (XXXXXXX) — build-edge.test.ts edge cases (14 тестов):
#              Пустой ввод / 1 ученик Light / 1 ученик Standard +
#              mixed_pages, Light overflow 17/25 учеников, decision_trace
#              корректность (spread_index монотонен, inputs snapshot),
#              cursors advance (current_student_index сбрасывается в
#              individual виньетке), защита от inf loop (правило без
#              consumes → warning), enabled_when пропускает секцию,
#              validateSectionParams §4.4 warnings (mini+has_quote),
#              prev_spread.right_page_empty корректно для J-Half tail.
#            Скрипты: 'npm test' / 'test:watch' / 'test:coverage'.
#            Все 77 тестов проходят за ~132ms. tsc clean, next build green.
# РЭ.11 — UI: TemplatePickerModal фильтрация по family_id
#         (партнёр видит только подходящие мастера при замене) — отложено
# РЭ.12 — UI: Редактор пресетов /app/presets — отложено (после запуска)
# ✅ РЭ.13 — POST endpoint + UI Build Test (3 коммита, 16.05.2026):
#            РЭ.13.1 (4e63d2c) — POST /api/layout?action=build_album_test_rules:
#              Параллельный к build_album_test, но через rule engine
#              (buildFromRules + loadBundle). Без фолбэка на legacy —
#              для теста сам факт сбоя ценнее тихого fallback'а.
#              Body: preset_id (из 'presets' табл) + те же синт. данные.
#              Response: { engine:'rules', status, spreads, decision_trace,
#                          warnings, rules_version, summary }.
#              Только superadmin.
#            РЭ.13.2 (5a91d3d) — UI Build Test (Rule Engine) в
#              /super/templates/[id]/page.tsx:
#              Фиолетовая кнопка-аккордеон рядом с существующим Build Test.
#              Отдельное состояние (rPresetId / rStudentsCount / rBuildResult
#              и т.п.) — чтобы пользователь мог сравнивать legacy и rules.
#              7 пресетов в селекторе (standard/universal/maximum/individual/
#              medium/light/mini-soft).
#              Отображение:
#                - status badge (green/yellow/red по статусу)
#                - warnings блок
#                - decision_trace: [#spread.section] family → rule_id
#                  с badges 'mixed' (оранжевый) и 'balanced' (синий) и
#                  inputs snapshot (remaining/idx).
#                - spreads: master_name слева | справа + раскрывающиеся bindings
#                - rules_version (хэш) внизу сводки
#            РЭ.13.3 — контекст v67 (текущий).
#            designer-tz v1.5 УЖЕ есть — designer-tz-2026-05-16-v1.5.md.
#            Проверки: tsc clean + next build green + 77 tests passing.
# ✅ РЭ.14 — Preview rule engine на реальных альбомах (3 коммита, 16.05.2026):
#            РЭ.14.1 (320dc98) — POST /api/layout?action=preview_rules_engine
#              + lib/rule-engine/legacy-adapter.ts:
#              adaptLegacyAlbumInput(AlbumInput) → RulesAlbumInput.
#              Маппинг half→half_class, head_teacher null→пустые поля,
#              template_set_id выбрасывается (rule engine получает через
#              RuleEngineBundle), collage не маппится (DEPRECATED).
#              Endpoint:
#                1. assertAlbumAccess + view_as паттерн как у build_album
#                2. buildAlbumInput (smart-fill) — РЕАЛЬНЫЕ данные альбома
#                3. adapt → RulesAlbumInput
#                4. loadBundle(preset_id, tenant_id) — tenant-aware
#                5. buildFromRules (не бросает, status в результате)
#                6. logAction 'layout.preview_rules_engine'
#                7. return spreads/decision_trace/warnings/
#                   smart_fill_warnings/summary
#              НИЧЕГО не пишет в album_layouts.
#              Access: owner/manager/viewer/superadmin (как build_album).
#            РЭ.14.2 (2f2ff31) — UI кнопка '🧪 Превью через Rule Engine'
#              в AlbumDetailModal:
#              Компонент RulesEnginePreviewBlock (отдельный, не вшит в
#              7900+ строк модала). Размещение: вкладка Обзор, внутри
#              блока legacy 'Layout собран', после warnings секций.
#              UI: селектор preset_id + 'Прогнать' button + результат.
#              Отображение: status badge / smart-fill warnings /
#              rule engine warnings / decision_trace (max-h-60 scroll) /
#              spreads (master_name | master_name + mixed badge).
#              useCallback добавлен в React import.
#            РЭ.14.3 — контекст v68 + how-to.
#            Безопасность: ни одна существующая кнопка/таблица/state
#            не меняется. Legacy layout, экспорт, редактор не задеты.
#            Проверки: tsc clean + next build green + 77 tests passing.
# ✅ РЭ.15 — Критический фикс singleton + cleanup (2 коммита, 16.05.2026):
#            РЭ.15.1 (f40a510) — КРИТИЧЕСКИЙ БАГ ПОЙМАН НА БОЕВОМ
#              АЛЬБОМЕ ЧЕРЕЗ РЭ.14 PREVIEW.
#              Симптом: для альбома 'тест 2026' (8 учеников, 1 предметник,
#              head_teacher, 10 общих + 9 половин фото) rule engine
#              создавал 19 разворотов head-teacher вместо одного.
#              Корень: правила t-class-1-4-half/full ПОТРЕБЛЯЛИ фото
#              (consumes.common_photos), защита cursorsChanged не
#              срабатывала. Алгоритм не знал что head-teacher должен
#              сработать один раз.
#              Фикс: хардкод ITERATIVE_FAMILIES в build.ts:
#                {'student-section', 'common-section'}.
#              Все остальные (head-teacher/intro/final/subject-teachers/
#              class-photo) — singleton, break после первого применения.
#              6 новых тестов в build-edge.test.ts (83 total).
#            РЭ.15.2 (5661a90) — подавить ложный 'consumed nothing'
#              warning для singleton. Замечено на 'Школа 89' mini-soft:
#              warning от final-text-only был шумом (правило без consumes
#              нормально завершается, не баг).
#              Фикс: warning только для итеративных семейств
#              (для singleton break без warning).
#              1 пара новых тестов (84 total).
#            Проверено руками Сергеем: 3 сценария дают status=ok/partial,
#            корректные spreads. RE готов к подключению в проде.
# ✅ РЭ.16 — Подключение к боевому build_album (4 коммита, 16.05.2026):
#            РЭ.16.1 (deca21e) — миграция albums.rules_preset_id:
#              text NULL, FK на presets(id), ON DELETE SET NULL.
#              Индекс WHERE NOT NULL. Безопасно для прода — добавляет
#              nullable колонку, ничего не удаляет.
#              ⚠️ Применить однократно: psql ... -f
#                 migrations/2026-05-16-albums-rules-preset-id.sql
#            РЭ.16.2 (43120bd) — главная часть:
#              lib/rule-engine/layout-to-buildresult.ts —
#                адаптер AlbumLayout → BuildResult (легаси формат).
#                Маппинг разворотов: left+right один мастер,
#                only-left/only-right, mixed_pages (warning + берём LEFT),
#                __master_name__ удаляется, __hidden__/__pos__ сохраняются,
#                __missing__/<name> skip + warning, failed→throw.
#                rules_meta содержит status/rules_version/decision_trace/
#                mixed_pages_indices для audit_log.
#                11 unit tests.
#              app/api/layout/route.ts:
#                В handleBuildAlbum развилка: если albums.rules_preset_id
#                IS NOT NULL — tryBuildViaRules (новая функция),
#                иначе legacy buildAlbum.
#                tryBuildViaRules: smart-fill → legacy-adapter →
#                loadBundle → buildFromRules → AlbumLayout→BuildResult
#                адаптер → enrichWarnings → upsert album_layouts
#                (config_preset_id=NULL) → logAction engine='rules'.
#                Auto-fallback на legacy при ЛЮБОЙ ошибке rule engine.
#                Response.rules_meta для UI.
#            РЭ.16.3 (731f85a) — UI селектор движка сборки:
#              Компонент RulesPresetControl в AlbumDetailModal на Обзор.
#              Dropdown '🧪 Движок сборки' с 8 опциями:
#                Legacy + 7 пресетов (standard/universal/maximum/
#                individual/medium/light/mini-soft).
#              Один-в-один паттерн VignettesControl: optimistic update,
#              rollback при ошибке, notify 'Пересоберите...'.
#              POST update_album принимает rules_preset_id в
#              allowedFields. Никаких новых валидаций — FK constraint
#              в БД отвергнет невалидное.
#            РЭ.16.4 — контекст v69 (текущий) с КАК ВКЛЮЧИТЬ how-to.
#            Безопасность:
#              - rules_preset_id=NULL → 100% legacy (все существующие
#                альбомы по умолчанию)
#              - Партнёр явно opt-in через UI
#              - Auto-fallback на legacy при ЛЮБОЙ ошибке rule engine
#              - album_layouts формат тот же → редактор/экспорт работают
#            Финал: 95 unit tests (77 базовых + 6 РЭ.15 + 1 split +
#            11 layout-to-buildresult).
# ✅ РЭ.17 — Критический фикс адаптера AlbumLayout→BuildResult 1:N (1 коммит):
#            РЭ.17.1 (660ee57) — НАЙДЕН СЕРГЕЕМ НА БОЕВОМ АЛЬБОМЕ ПОСЛЕ РЭ.16.3.
#              Симптом: после переключения 'тест 2026' на Rule Engine universal
#              в редакторе разворот 1 показывал F-Head-SmallGrid (учитель)
#              СЛЕВА + E-Universal-Left (Егоров Тимур) СПРАВА — head-teacher
#              и первый ученик в одном развороте. G-HalfClass (правая сторона
#              учительского разворота) пропала.
#              Корень: legacy формат имеет семантику '1 SpreadInstance = 1
#              СТРАНИЦА (одна сторона)', spread_index — глобальный индекс
#              СТРАНИЦЫ. Редактор группирует попарно (0+1, 2+3, …) в
#              визуальные развороты. РЭ.16.2 адаптер ошибочно делал 1:1
#              (rule engine spread с двумя страницами → один legacy
#              SpreadInstance с template_id=LEFT). Правая страница терялась.
#              Фикс: 1:N маппинг. spread.is_spread=true → 1 SpreadInstance
#              (двухстраничный мастер). is_spread=false → отдельный
#              SpreadInstance на каждую сторону (left и/или right).
#              pageCounter — глобальный legacy spread_index.
#              Старый warning 'mixed_pages_not_supported_by_editor' УБРАН —
#              был ошибочным допущением, mixed_pages при 1:N — нормальный
#              случай.
#              5 новых тестов в layout-to-buildresult.test.ts.
#              Проверки: tsc clean, build green, 97 unit tests passing.
# ✅ РЭ.18 — Полноценный общий раздел в rule engine (3 коммита, 16.05.2026):
#            РЭ.18.1 (4de8aaa) — фундамент типов:
#              + RulesAlbumInput.common_section_max_spreads?: number|null
#              + RuleContext.common_section: {
#                  spreads_created, max_spreads, spreads_remaining
#                }
#              + cursor common_section_spreads_created в build.ts с авто-
#                инкрементом после успешного применения common-section правил
#              + buildContext вычисляет spreads_remaining как
#                max(0, max_spreads - created), либо null без лимита
#              + legacy-adapter прокидывает albums.common_section_max_spreads
#                из legacy AlbumInput в RulesAlbumInput (до РЭ.18 выбрасывалось)
#              + mocks тестов RuleContext обновлены чтобы включать поле
#            РЭ.18.2 (3fd3807) — 4 новых правила:
#              common-section-full-class-pair (200) — J-ClassPhoto + J-ClassPhoto-Right,
#                consumes full_class:2
#              common-section-half-class-pair (190) — J-Half + J-Half (симметричный,
#                left_master/right_master ключи), consumes half_class:4
#              common-section-quarter-pair (180) — J-Quarter + J-Quarter,
#                consumes quarter:4
#              common-section-sixth-pair (170) — J-Collage + J-Collage,
#                consumes sixth:12 (по 6 фото на странице)
#              Все with when: { common_section.spreads_remaining: { neq: 0 } }.
#              Существующие common-fill-hanging-page-* (80-100) остаются.
#              TEST_MASTERS расширен 4 мастерами.
#              7 новых тестов: full_class сценарий, max_spreads=2/0/null,
#              приоритет full→half, sixth pair, регрессия fill-hanging.
#              Обновлён старый 'Сценарий тест 2026' (5→13 разворотов).
#              ⚠️ Сергею: повторить `seed-rule-engine.ts --write` для
#                деплоя 4 новых правил в БД (40 rules итого).
#              Финал: 104 unit tests (97 + 7).
#            РЭ.18.3 — контекст v70 (текущий).
#            Безопасность:
#              - Существующие альбомы на legacy не задеты (rules_preset_id=NULL)
#              - Rule engine альбомы с пустым общим разделом теперь его
#                получат при следующем 'Пересобрать'
#              - albums.common_section_max_spreads (давно есть) теперь
#                реально соблюдается rule engine'ом (был баг — лимит
#                игнорировался при rule engine пути).
# ✅ КЭ — Контент-редактор фото (8 коммитов, 16.05.2026):
#            Главная блокирующая дыра на пути к августовской партнёрке.
#            Без КЭ партнёр не мог подкрутить crop фото — жёсткий cover
#            crop по короткой стороне был единственным вариантом.
#            После КЭ есть полный аналог InDesign content positioning:
#              - SCALE — масштабирование 100..200% через slider
#              - OFFSET — двумерный сдвиг X/Y touchpad'ом или numeric
#                input'ами для точной правки
#            Хранение: служебные ключи __scale__<label> / __offset__<label>
#            в album_layouts.spreads[].data (та же конвенция что
#            __hidden__/__pos__). Обратная совместимость 100% — альбомы
#            без transform-ключей рендерятся идентично старому коду через
#            regression-safe fast path.
#            КЭ.1 (d46f53a) — lib/photo-transform/index.ts + 33 unit тестов
#              Единый источник правды для логики crop. Используется в
#              Konva (PhotoSlot) и в sharp (PDF export).
#              computeCrop / parseScale / parseOffset / serializeScale /
#              serializeOffset / hasCustomTransform helpers.
#            КЭ.2 (7490a4a) — AlbumSpreadCanvas.PhotoSlot integration
#              Удалена локальная getCoverCrop, используется computeCrop.
#              PhotoSlot принимает scale/offsetX/offsetY props (default
#              1, 0, 0 → backward compat). Call-site парсит __scale__/
#              __offset__ из instance.data.
#            КЭ.3 (6873c3e) — POST /api/layout?action=update_data
#              Generic endpoint для точечного PATCH ключей spread.data.
#              Whitelist валидация ключей (regex), read-only защита,
#              audit log. Не используется в КЭ.5 (там через save_album_
#              layout), но остаётся для будущего (realtime collab,
#              другие точечные правки).
#            КЭ.4 (62344b5) — PhotoTransformPanel компонент
#              Inline popover в стиле PhotoContextMenu.
#              Slider масштаба + touchpad 120×120 + numeric inputs X/Y +
#              кнопки 'Сбросить' / 'Готово'. Pointer events для iPad
#              поддержки. Закрытие по Esc / клику вне.
#            КЭ.5 (089c8af) — интеграция Panel в LayoutEditorPage
#              Новый prop onPhotoClick в AlbumSpreadCanvas. Одинарный
#              клик левой кнопкой (не drag) открывает panel. setLayout
#              optimistic update — Л.4 auto-save mechanism подхватит
#              через 2с debounce. Сброс при undo/redo/смене разворота.
#            КЭ.6 (1e03011) — '⚙' бейдж 'Кадрирован вручную'
#              DOM-overlay в DropZone (только edit mode). Помогает
#              партнёру быстро увидеть какие фото подкручены вручную.
#              hasCustomTransform helper из lib/photo-transform.
#            КЭ.7 (3619e8f) — PDF-экспорт integration
#              embedPhotoOnPage расширена параметрами scale/offsetX/Y.
#              Two paths inside sharp:
#                hasCustom=false → fast path fit:'cover' (regression-safe)
#                hasCustom=true  → sharp.extract + fit:'fill' через
#                                  тот же computeCrop что в Konva
#              Pixel rounding в sharp — известный compromise (<0.1%
#              сдвига на 300dpi, невидимо глазом).
#            КЭ.8 — контекст v71 (текущий).
#            Связано: docs/phase-content-edit-spec.md v1.1.
#
# Реалистичная скорость: 2-3 коммита в неделю → 3-5 недель до MVP.
# С запасом до запуска партнёрки в сентябре — ОК.
#
# ────────────────────────────────────────────────────────────────────
# СВЯЗАННЫЕ ДОКУМЕНТЫ RULE ENGINE
# ────────────────────────────────────────────────────────────────────
#
# Эти файлы НЕ ТРОГАТЬ без согласования с Сергеем:
#   docs/rule-engine-spec.md v1.3 (актуальная — 16.05.2026 после IDML v2) — главная спека
#   docs/templates/architecture-decisions-2026-05-15.md (257 строк)
#   docs/templates/architecture-decisions-2026-05-12.md (124 строки)
#   docs/templates/composition-catalog.md (427 строк)
#   docs/templates/data/composition-catalog-filled-2026-05-15.xlsx
#   docs/templates/designer-tz-2026-05-16-v1.5.md (v1.5 — актуальная,
#     после получения IDML v2; Combined правильные размеры M=2/L=3/N=4)
#   docs/templates/designer-tz-2026-05-16.md (v1.4 — для истории)
#   docs/templates/designer-tz-2026-05-15.md (v1.3 — для истории)
#   docs/templates/designer-tz-2026-05-12.md (v1.2 — для истории)
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

# =========================================================================
# ДОПОЛНЕНИЕ от 18.05.2026 — финальные уточнения от Сергея перед закрытием
# сессии. Эти данные нужны для РЭ.20 и РЭ.12.
# =========================================================================
#
# РАЗНИЦА ПРЕСЕТ vs АЛЬБОМ (важно для РЭ.12 UI):
#   - Альбом = конкретный заказ конкретного класса (например '9А, 2026,
#     24 ученика'). Принадлежит партнёру. Имеет фото, учеников, статус.
#   - Пресет = шаблон конфигурации применяемый к альбомам ('Лайт-плотный
#     с 24 страницами, общий до 4 разворотов'). Создаётся один раз и
#     применяется к МНОГИМ альбомам.
#   - Сейчас common_section_max_spreads на уровне альбома — ОШИБКА
#     архитектуры. Это должно быть на уровне пресета.
#   - total_pages тоже идёт в пресет.
#   - У альбома будет ТОЛЬКО rules_preset_id (FK на пресет) — конкретные
#     числа берутся из пресета.
#
# ФОРМУЛЫ total_pages OkeyBook default-пресетов (от Сергея, могут уточниться):
#   Стандарт/Универсал = students × 1 (1 страница на ученика) + 8
#   Медиум плотные    = ceil(students / 4) + 8
#   Медиум мягкие     = ceil(students / 4) + 8
#   Лайт плотные      = ceil(students / 6) + 8
#   Лайт мягкие       = ceil(students / 6) + 8
#   Мини плотные      = 6 (фиксированно)
#   Мини мягкие       = 6 (фиксированно)
#
# Эти числа Сергей не помнит точно — настройка ГИБКАЯ. Партнёр может
# переопределить через UI пресета (РЭ.12). Это только default.
#
# УЧИТЕЛЬСКИЙ РАЗДЕЛ:
#   - 1 или 2 страницы в зависимости от пресета
#   - Для Мини мягких может занимать место S-Intro (intro_section)
#   - F-Head-* мастера (8 вариантов в БД сейчас)
#
# INTRO/FINAL для мягких (S-Intro / S-Final):
#   - Отдельные мастера, по 1 странице каждый
#   - В Мини мягких intro может заменяться учительским разделом
#
# РАЗВОРОТ = СТРАНИЦЫ:
#   - Везде 1 разворот = 2 страницы
#   - Исключение: фотопапка трюмо = 3 страницы (отложено на потом)
#
# ВЫБОР АЛЬТЕРНАТИВ в общем разделе (как «либо 6×1/6, либо 2×1/2, либо 1 общая»):
#   - Система авто-выбирает по наличию фото:
#     если sixth >= 6 → '6×1/6'
#     иначе если half_class >= 2 → '2×1/2'
#     иначе если full_class >= 1 → '1 общая'
#     иначе → пропуск страницы (партнёр заменит мастер вручную)
#   - Партнёр может вручную поменять мастер в редакторе через
#     TemplatePickerModal — это уже работает в Л.M

# =========================================================================
# ПЛАН СЛЕДУЮЩЕЙ СЕССИИ — РЭ.12 (UI редактор пресетов) + РЭ.20 (матрица)
# =========================================================================
#
# РЭ.12 и РЭ.20 взаимозависимы — нужно делать вместе.
# Без РЭ.12 партнёр не может настроить пресет.
# Без РЭ.20 правила в пресете не работают по матрице.
#
# Порядок реализации (обновлено 18.05.2026 вечером после РЭ.21.4):
#   ✅ РЭ.20.2..РЭ.20.5 — миграция БД, типы, матрица-модуль, значения.
#   ✅ РЭ.20.6.1 (6be5ab5) — consumes.pages + mandatory_section.pages.
#   ✅ РЭ.20.6.2 (a8d82cb) — RuleContext.preset_density/sheet_type.
#   ❌ РЭ.20.6.3 (откачено в e82ea73) — генератор правил из матрицы.
#   ✅ РЭ.21.1 (5d38b77) — presets.section_structure jsonb.
#   ✅ РЭ.21.2 (046afe5) — дефолты для 7 пресетов.
#   ✅ РЭ.21.3 (b0497bc) — UI: модал «Пресеты» с просмотром.
#   ✅ РЭ.21.4 (7917489) — UI: создание пресета с нуля.
#   ✅ РЭ.21.5.1 (057bf79) — миграция min_pages/max_pages (nullable).
#   ✅ РЭ.21.5.2 (db3adbb) — типы + API + форма + карточка с диапазоном.
#   ✅ РЭ.21.5.3 (fb69a30) — DROP COLUMN total_pages + fix кода.
#   ✅ РЭ.21.6.1 (df8c1f0) — миграция presets.template_set_id uuid FK.
#   ✅ РЭ.21.6.2 (87e894f) — типы + loader + build engine + API валидация.
#   ✅ РЭ.21.6.3 (c10b0fa) — UI: селект «Дизайн» в форме + карточка.
#   ✅ РЭ.21.7.1 (029ac0d) — API rule_preset_update (partial patch).
#   ✅ РЭ.21.7.2 (08d2941) — UI базового редактирования (mode='edit').
#   ✅ РЭ.21.7.3 (80b56e2) — DnD редактор секций.
#   ✅ РЭ.21.7.4 (0657138) — DnD редактор слотов внутри common.
#   ✅ РЭ.21.7.5.1 (75a36e7) — API принимает density.
#   ✅ РЭ.21.7.5.2 (3d4ad49) — UI density-dropdown внутри секции students.
#   ✅ РЭ.21.7.5.3 (f95a063) — density в PresetCard под секцией students.
#
# Дальше (план на следующие сессии):
#   1. РЭ.21.8 — подключение section_structure к build engine.
#      Если у пресета есть section_structure → engine идёт по нему
#      слот за слотом. Реализация цепочек flex_A/B/C из build_album.jsx.
#      Это самый сложный шаг, но и самый ценный — без него вся
#      архитектура декоративна.
#      В этом же шаге engine начинает учитывать min_pages/max_pages
#      (выбор фактического числа страниц на уровне альбома в зависимости
#      от количества учеников).
#   2. РЭ.21.9 — копирование глобального пресета как стартового.
#      Кнопка «Скопировать как мой» на карточке глобального пресета.
#   3. РЭ.21.10 — финальная документация архитектуры.
#
# ## Будущий переезд density в section.params (отложено):
#   Сейчас density физически живёт на preset.density (одно значение на
#   пресет). UI после РЭ.21.7.5 уже показывает density как параметр
#   секции students — это "B-стиль на старте". Когда понадобится
#   несколько разных плотностей в одном пресете (например, "первые 4
#   ученика в Стандарт-сетке, остальные в Лайт-сетке"), будет аккуратный
#   переезд:
#     • Расширить SectionStructureEntry новым вариантом для students с
#       params.density: PresetDensity.
#     • Migration: backfill section.params.density из preset.density.
#     • Build engine читает density из section, не из preset.
#     • После переходного периода удалить колонку preset.density.
#   Объём переезда ~3-4 коммита (миграция + engine + UI consume + cleanup).
#
# ## Параллельная задача для Сергея (вне разработки):
#   Все 7 встроенных пресетов имеют корректные диапазоны (проставлено
#   18.05.2026). custom-vrfxcuqi имеет NULL — можно удалить или
#   проставить через SQL UPDATE (а можно через UI: открыть
#   «Редактировать» и сохранить — форма дефолтит 24/24 для NULL полей).
#   Все 9 пресетов имеют template_set_id = NULL → loadBundle применяет
#   фолбэк okeybook-default. Заполнение конкретными uuid'ами — через UI
#   формы создания/редактирования (рекомендуется) или вручную через SQL.
#
# Эстимация всего: 40-60 часов работы, 2-3 недели при темпе 2-3 коммита
# в неделю. Реалистично до конца июня — после этого июль на маркетинг,
# август на запуск партнёрки.

# =========================================================================
# ОТЛОЖЕНО / ПАРАЛЛЕЛЬНЫЕ ЗАДАЧИ:
# =========================================================================
#
# РЭ.11 — UI фильтр TemplatePickerModal по family_id (1-2 коммита, мелочь)
# Переезд с Vercel на Timeweb/YC App Platform (июнь, отдельная задача)
# Биллинг через менеджера (июль, перед запуском партнёрки)

# =========================================================================
# ПРАВИЛА БЕЗОПАСНЫХ МИГРАЦИЙ БД (зафиксировано 18.05.2026)
# =========================================================================
#
# После инцидента РЭ.21.5.3 (Сергей применил DROP COLUMN раньше деплоя
# кодовых правок — прод временно падал на /app → «Пресеты»):
#
# ## Удаление колонки (DROP COLUMN) — порядок:
#   1. Сначала код: удалить SELECT/INSERT/чтение колонки.
#   2. tsc + next build → зелёный → коммит → push на main.
#   3. Дождаться завершения деплоя Vercel (1-2 минуты).
#   4. ТОЛЬКО ПОСЛЕ ЭТОГО — ALTER TABLE … DROP COLUMN в Supabase.
#
# ## Добавление колонки (ADD COLUMN) — порядок обратный:
#   1. Сначала SQL: ALTER TABLE … ADD COLUMN (nullable, без NOT NULL).
#   2. Потом код: добавить чтение/запись, типы, UI.
#   3. Прод не падает ни в одной точке (старый код не видит новую
#      колонку, новый код видит).
#
# ## Изменение типа/переименование колонки — двухфазно:
#   1. Добавить новую колонку рядом со старой.
#   2. Код пишет в обе, читает приоритетно из новой.
#   3. Backfill старых данных в новую колонку.
#   4. Код перестаёт писать в старую.
#   5. Деплой → дождаться → DROP COLUMN старая.
#
# Эти правила универсальны (zero-downtime миграции). Применяются ко
# всем будущим изменениям схемы БД на продакшене.

# =========================================================================
# SQL ДЛЯ ДЕФОЛТОВ ДИАПАЗОНОВ (для шага B после РЭ.21.5.2)
# =========================================================================
#
# После применения миграции РЭ.21.5.1 у всех пресетов min_pages/max_pages
# равны NULL. Фронт показывает фолбэк на total_pages — это работает, но
# для правильного отображения и для будущего РЭ.21.8 (где engine начнёт
# учитывать диапазон) нужно проставить осмысленные значения.
#
# Цифры ниже — стартовые предложения. Сергей может скорректировать перед
# применением. SQL запустить в Supabase SQL Editor.
#
# UPDATE presets SET min_pages = 6,  max_pages = 6   WHERE id = 'mini-soft';
# UPDATE presets SET min_pages = 8,  max_pages = 16  WHERE id = 'individual';
# UPDATE presets SET min_pages = 12, max_pages = 20  WHERE id = 'light';
# UPDATE presets SET min_pages = 16, max_pages = 32  WHERE id = 'medium';
# UPDATE presets SET min_pages = 20, max_pages = 50  WHERE id = 'standard';
# UPDATE presets SET min_pages = 20, max_pages = 50  WHERE id = 'universal';
# UPDATE presets SET min_pages = 24, max_pages = 100 WHERE id = 'maximum';
#
# Для custom-vrfxcuqi («Мой пресет для школ») — на усмотрение Сергея.
#
# Проверка после применения:
#   SELECT id, display_name, total_pages, min_pages, max_pages
#   FROM presets ORDER BY id;
#
# Ожидание: ни одной NULL в колонках min/max (кроме custom-* если решено
# оставить как есть).
