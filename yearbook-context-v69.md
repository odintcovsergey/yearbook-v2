# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v69
# Обновлено: 16.05.2026 (РЭ.15+РЭ.16 закрыты — rule engine ПОДКЛЮЧЁН
#                       к боевому build_album в миграционном режиме.
#                       Партнёр выбирает движок через UI dropdown,
#                       auto-fallback на legacy при сбоях.)
#
# ⚠️ ВАЖНО: ПРЕЖДЕ ЧЕМ ПРИНИМАТЬСЯ ЗА ЛЮБУЮ ДРУГУЮ РАБОТУ — ПРОЧИТАЙ:
#   docs/rule-engine-spec.md              — ✅ спецификация rule engine v1.3 (16.05.2026)
#   docs/templates/architecture-decisions-2026-05-15.md — фундамент rule engine (12 решений)
#   docs/templates/composition-catalog.md — каталог композиций
#   docs/templates/data/composition-catalog-filled-2026-05-15.xlsx — заполнен Сергеем
#   docs/phase-l-spec.md                  — спецификация фазы Л v2 (✅ ЗАКРЫТА)
#   docs/roadmap-after-phase-3.md         — план фаз до боеготовности
#   docs/designer-questions-2026-05-10.md — вопросы дизайнеру + ответы
#   docs/templates/master-cleanup-tz.md   — раздел F5 (виртуальные страницы)
#   yearbook-context-v56.md               — фазы М + техдолг детально
#   yearbook-context-v55.md               — фазы Л + П детально
#   yearbook-context-v54.md               — фаза К детально
#
# СТАТУС: АКТИВНЫЙ СЕЗОН (май 2026) + RULE ENGINE В БОЕВОЙ ПРОДЕ
# Workflow производства готов. Партнёрский кабинет готов.
# Личный разворот реализован. CRM готов.
# Все фото в Yandex Object Storage.
# Цветокор/ретушь end-to-end работает в проде (фаза К — 12.05.2026).
# CORS на YC bucket настроен (исправлен критический баг Б.1.3).
# Редактор макета готов (фаза Л — 12.05.2026).
# Структурное редактирование макета готово (фаза М — 12.05.2026, вечер).
#
# Rule engine ПОЛНОСТЬЮ подключён к боевому build_album:
#   ✅ Спецификация v1.3 + 7 семейств + 36 правил + 7 пресетов
#   ✅ Алгоритм buildFromRules (РЭ.9, ~1.5K строк)
#   ✅ 95 unit tests (РЭ.10 + РЭ.16.2 адаптер, 137ms)
#   ✅ Sandbox endpoint + UI Build Test в /super/templates (РЭ.13)
#   ✅ Preview endpoint + UI кнопка в AlbumDetailModal (РЭ.14)
#   ✅ Singleton-fix + warnings cleanup (РЭ.15)
#   ✅ albums.rules_preset_id миграция (РЭ.16.1)
#   ✅ handleBuildAlbum развилка + AlbumLayout→BuildResult адаптер (РЭ.16.2)
#   ✅ UI селектор '🧪 Движок сборки' (РЭ.16.3)
#   ✅ Контекст v69 (РЭ.16.4)
#
# 📍 КАК ВКЛЮЧИТЬ RULE ENGINE ДЛЯ КОНКРЕТНОГО АЛЬБОМА:
#   1. Один раз: применить миграцию в Supabase
#      psql ... -f migrations/2026-05-16-albums-rules-preset-id.sql
#   2. Один раз: залить правила/пресеты в БД
#      npx tsx --env-file=.env.local scripts/seed-rule-engine.ts --write
#   3. Открыть альбом в кабинете → вкладка Обзор
#   4. В блоке 'Пресет вёрстки' под 'Виньетки класса' появится новый
#      dropdown '🧪 Движок сборки'
#   5. Выбрать 'Rule Engine: <preset>' из 7 опций
#   6. Нажать 'Пересобрать' → собирается через buildFromRules
#   7. Результат пишется в album_layouts в legacy формате
#      (адаптер AlbumLayout→BuildResult из РЭ.16.2)
#   8. Редактор фазы Л/М, экспорт, превью работают без изменений
#   9. Переключение обратно на 'Legacy' → следующий Пересобрать через
#      старый buildAlbum. Операция полностью обратимая.
#
# Auto-fallback: при ЛЮБОЙ ошибке rule engine (smart-fill не отработал,
# bundle не загружен, status='failed', adapter бросил) — handleBuildAlbum
# тихо переключается на legacy. Партнёр не остаётся без layout'а.
#
# Следующий шаг — на выбор Сергея:
#   - Сравнить rule engine vs legacy на ботовых альбомах (тест 2026,
#     Школа 89): переключить один в RE, второй в Legacy, нажать
#     Пересобрать → открыть в редакторе и посмотреть глазами.
#   - Если результат rule engine лучше → переключить больше альбомов.
#   - Если хуже / странности → правки правил JSON + новые unit tests.
#   - РЭ.11 (UI фильтр TemplatePickerModal по family_id) и РЭ.12 (UI
#     редактор пресетов /app/presets) — отложены, не блокеры.
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
#    Подэтапы РЭ.1-РЭ.10 + РЭ.13 + РЭ.14 + РЭ.15 + РЭ.16 ✅ выполнены.
#    Rule engine ПОДКЛЮЧЁН к боевому build_album в миграционном режиме.
#    РЭ.11 (UI фильтр picker'а) + РЭ.12 (UI редактор пресетов) — отложены.
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
