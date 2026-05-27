# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v178
# Обновлено: 27.05.2026 (вечер, РЭ.59 + продуктовые решения по будущим мастерам + адаптация форматов)
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО В V178 (27.05.2026 — РЭ.59 + диагностика IDML)          │
# │                                                                    │
# │ 1 коммит + продуктовые решения и backlog по будущим мастерам.      │
# │ Короткая сессия, но важная для архитектуры.                        │
# │                                                                    │
# │ ═══════ feat c529881 (РЭ.59) — категория common_collage ═══════    │
# │                                                                    │
# │ Сергей попросил отдельный пул фото для коллажных вариаций (3-8     │
# │ фото на странице), не трогая common_sixth (которая остаётся для    │
# │ J-Collage-4 и J-Collage-6).                                        │
# │                                                                    │
# │ Сделана ИНФРАСТРУКТУРА: партнёр уже может загружать фото в новую   │
# │ категорию, фото сохраняются в БД с type='common_collage'. В        │
# │ палитре редактора появляется отдельный таб «Коллаж».               │
# │                                                                    │
# │ ОТЛОЖЕНО (для будущей задачи):                                     │
# │   • Поле collage_section в CommonPhotos type                       │
# │   • В build-album-input.ts push common_collage в это поле          │
# │   • Aspect-aware fitting (анализ EXIF → ставить вертикальные фото  │
# │     в вертикальные слоты)                                          │
# │   • Сохранение width × height фото при загрузке                    │
# │   • Мастера J-Collage-3/5/7/8 в IDML с микшированными горизонталь- │
# │     ными/вертикальными слотами (Сергей нарисует)                   │
# │   • Family-mapping для J-Collage-N                                 │
# │   • Билдер использует common_collage пул                           │
# │                                                                    │
# │ Изменения в этом коммите:                                          │
# │   • migrations/2026-05-27-photos-type-common-collage.sql:          │
# │     DROP/CREATE photos_type_check с добавленным common_collage.    │
# │     Идемпотентная (IF EXISTS защита).                              │
# │   • schema.sql: +common_collage в CHECK для согласия с миграцией   │
# │   • app/api/tenant/route.ts: union type и validation (3 места)     │
# │   • app/api/upload/route.ts: allowedTypes +common_collage          │
# │   • app/api/workflow/originals-zip/route.ts: ALL_CATEGORIES        │
# │   • app/app/page.tsx (UI загрузки фото):                           │
# │     - PhotoKind +common_collage                                    │
# │     - PHOTO_KINDS_COMMON +common_collage                           │
# │     - photoKindLabel: 'Коллаж'                                     │
# │     - initial upload state +common_collage                         │
# │     - UI label: 'Общий: коллаж'                                    │
# │   • app/app/_components/PhotoPalette.tsx (редактор):               │
# │     - AlbumPhoto union +common_collage                             │
# │     - PaletteTab union +common_collage                             │
# │     - TAB_LABELS.common_collage = 'Коллаж'                         │
# │     - filtered + counts + visibleTabs учитывают категорию          │
# │   • app/app/album/[id]/layout/page.tsx: AlbumPhoto +common_collage │
# │   • lib/smart-fill/build-album-input.ts: фото подтягиваются в      │
# │     input, но в CommonPhotos пока не складываются (ждут будущей    │
# │     задачи)                                                        │
# │                                                                    │
# │ Сергей применил миграцию в Supabase Studio SQL Editor →            │
# │ 'Success. No rows returned'. ✅                                    │
# │                                                                    │
# │ ═══════ ДИАГНОСТИКА J-COMBINED-TAIL ═══════                        │
# │                                                                    │
# │ Сергей показал JSON layout-а где personal section собрался         │
# │ корректно (25 учеников, distribution=Жадно → 12+11+2 после         │
# │ симметризации), и в spread_index=3 использовался мастер с          │
# │ template_id 'e621309f-6d71-49fa-be45-96a96895d25e'.                │
# │                                                                    │
# │ Через SQL выяснили: это J-Combined-Tail-4 в template_set           │
# │ okeybook-default. Геометрия в БД РАЗУМНАЯ (4 портрета в ряд        │
# │ сверху, имена под каждым, большое общее фото снизу 191×135mm) —    │
# │ не миграционная заглушка (там были другие координаты).             │
# │                                                                    │
# │ ВЫВОД: Сергей раньше нарисовал J-Combined-Tail-4 в IDML, но        │
# │ забыл про это. Он уже работает в системе.                          │
# │                                                                    │
# │ ВАЖНЫЙ НЮАНС:                                                      │
# │   Для класса 25 (Жадно, Mini 12) симметризация даёт 12+11+2.       │
# │   На хвосте 2 ученика — нужен J-Combined-Tail-2, не -4!            │
# │   Билдер взял J-Combined-Tail-4 как ближайший большой и скрыл      │
# │   2 лишних слота (__hidden__studentportrait_3, _4). Работает, но   │
# │   композиция не идеальна — фактически на странице 2 портрета       │
# │   занимают только 2 из 4 широких слотов.                           │
# │                                                                    │
# │ Поэтому в backlog: дорисовать -2, -3, -2-Right, -3-Right,          │
# │ -4-Right (см. ниже).                                               │
# │                                                                    │
# │ ═══════ ПРОДУКТОВЫЕ РЕШЕНИЯ И BACKLOG ═══════                      │
# │                                                                    │
# │ Сергей принял несколько решений на будущее:                        │
# │                                                                    │
# │ 1. **N-Grid-Page-9 (3×3 ровный)**:                                 │
# │    Сергей нарисовал в IDML. Подгрузится при следующей загрузке.    │
# │    Зачем: хвост 9 учеников на Mini (25, 26, 27 — типичные случаи) │
# │    сейчас отображается как N-Grid-Page (12) со скрытыми 3-мя       │
# │    слотами. Композиция «9 портретов в неровной сетке 4×3 минус     │
# │    угол» не идеальна — отдельный 3×3 мастер выглядит чище.         │
# │                                                                    │
# │    Что нужно сделать в коде ПОСЛЕ загрузки:                        │
# │      • family-mapping.ts: +N-Grid-Page-9 (density=mini, params     │
# │        grid_modes [{slot_count: 9, rows: 3, cols: 3}],             │
# │        page_role='student_grid', slot_capacity students=9,         │
# │        has_quote=false, has_portrait=true, has_name=true)          │
# │      • students.ts findStudentGridMaster: предпочитать exact-match │
# │        N-Grid-Page-9 для density=mini && students=9                │
# │                                                                    │
# │ 2. **N-Grid-Page-6, L-Grid-Page-4, L-Grid-Page-2** — отложено.     │
# │    Сергей оценит сам нужны ли они когда увидит реальные случаи     │
# │    деградации сеток.                                               │
# │                                                                    │
# │ 3. **J-Combined-Tail серия** — 5 недостающих мастеров для          │
# │    Сергея, см. отдельный раздел ЗАДАЧИ ДЛЯ СЕРГЕЯ ниже.             │
# │                                                                    │
# │ 4. **Коллажные фото** — Сергей выбрал отдельную категорию          │
# │    common_collage (НЕ расширять common_sixth). Сделано РЭ.59.      │
# │    Мастера и aspect-aware fitting в будущем.                       │
# │                                                                    │
# │ ═══════ ЗАДАЧИ ДЛЯ СЕРГЕЯ (рисование в IDML) ═══════               │
# │                                                                    │
# │ Когда будет время — нарисовать в IDML:                             │
# │                                                                    │
# │ A. **5 недостающих J-Combined-Tail мастеров**:                     │
# │                                                                    │
# │    • J-Combined-Tail-2 — 2 портрета сверху + общее фото снизу,    │
# │      левая страница разворота                                      │
# │      Метки: studentportrait_1..2, studentname_1..2, classphotoframe│
# │                                                                    │
# │    • J-Combined-Tail-2-Right — то же, правая страница (зеркало)   │
# │                                                                    │
# │    • J-Combined-Tail-3 — 3 портрета + общее фото, левая           │
# │      Метки: studentportrait_1..3, studentname_1..3, classphotoframe│
# │                                                                    │
# │    • J-Combined-Tail-3-Right — правая                              │
# │                                                                    │
# │    • J-Combined-Tail-4-Right — правая (Tail-4 левая УЖЕ ЕСТЬ)     │
# │      Метки: studentportrait_1..4, studentname_1..4, classphotoframe│
# │                                                                    │
# │    Зачем нужны -Right зеркала:                                     │
# │      Когда страница попадает на правую сторону разворота, общее   │
# │      фото примыкает к корешку с ДРУГОЙ стороны. Композиция должна │
# │      быть зеркальной чтобы выглядела цельно.                       │
# │                                                                    │
# │    Где применяются:                                                │
# │      Хвостовая страница раздела учеников когда осталось 2/3/4     │
# │      ученика + есть общее фото класса (common_full). Билдер сам   │
# │      выбирает правильный мастер по числу учеников в хвосте.        │
# │                                                                    │
# │ B. **Дополнительные J-Collage мастера** (после готовности кода):  │
# │                                                                    │
# │    • J-Collage-3 — 3 фото на странице                              │
# │    • J-Collage-5 — 5 фото                                          │
# │    • J-Collage-7 — 7 фото                                          │
# │    • J-Collage-8 — 8 фото                                          │
# │                                                                    │
# │    Возможны несколько вариаций под одно N (например J-Collage-5-A,│
# │    J-Collage-5-B с разными композициями).                          │
# │                                                                    │
# │    Слоты могут быть микшированными — вертикальные и горизонталь-  │
# │    ные на одной странице. Билдер с aspect-aware fitting сам         │
# │    подберёт какое фото в какой слот.                               │
# │                                                                    │
# │    Зависит от готовности:                                          │
# │      • Кода для расширения CommonPhotos.collage_section            │
# │      • Aspect-aware fitting логики                                 │
# │      • Сохранения width×height фото при загрузке                   │
# │                                                                    │
# │ ═══════ ЗАДАЧИ ДЛЯ КОДА (после загрузки новых мастеров) ═══════    │
# │                                                                    │
# │ После того как Сергей нарисует и загрузит:                         │
# │                                                                    │
# │ 1. **N-Grid-Page-9 family-mapping** (~15 мин):                     │
# │    Добавить запись в lib/idml-converter/family-mapping.ts:         │
# │      page_role='student_grid', density='mini',                     │
# │      slot_capacity={students:9, has_portrait:true, has_name:true}, │
# │      params {parametric:true, grid_modes:[{slot_count:9,rows:3,    │
# │      cols:3}]}                                                     │
# │                                                                    │
# │ 2. **N-Grid-Page-9 предпочтение в students.ts** (~30 мин):         │
# │    findStudentGridMaster для density=mini && actualCount=9         │
# │    должен предпочитать exact-match (N-Grid-Page-9) перед           │
# │    параметрическим (N-Grid-Page со скрытием).                      │
# │                                                                    │
# │ 3. **J-Combined-Tail family-mapping** (уже сделано РЭ.58):         │
# │    Все 6 мастеров уже в family-mapping.ts. При следующей загрузке │
# │    IDML с дорисованными мастерами они получат правильные page_     │
# │    role/slot_capacity без дополнительных действий.                 │
# │                                                                    │
# │ 4. **J-Collage common_collage интеграция** (~3-4 часа):            │
# │    • lib/album-builder/types.ts: CommonPhotos +collage_section     │
# │    • lib/smart-fill/build-album-input.ts: case 'common_collage' →  │
# │      common_photos.collage_section.push(url)                       │
# │    • Сохранение width × height в БД при загрузке фото:             │
# │      - Миграция: photos +width int, +height int                    │
# │      - app/api/upload/route.ts: вычислять размеры через sharp       │
# │        перед записью                                               │
# │    • Aspect-aware fitting в lib/rule-engine/sections/common*.ts:   │
# │      сортировать common_collage фото по aspect ratio,              │
# │      сортировать слоты мастера по aspect ratio,                    │
# │      сопоставлять greedy матчингом (vert→vert, horiz→horiz).       │
# │    • family-mapping для J-Collage-3/5/7/8 (когда Сергей создаст)  │
# │                                                                    │
# │ ═══════ КОММИТЫ ЗА V178 (2 шт) ═══════                              │
# │                                                                    │
# │   c529881 — feat РЭ.59: новая категория common_collage             │
# │   (этот) — docs: context v178                                      │
# │                                                                    │
# │ ═══════ МИГРАЦИИ ДЛЯ ПРИМЕНЕНИЯ К ПРОДУ ═══════                    │
# │                                                                    │
# │ Применено Сергеем 27.05.2026:                                      │
# │   ✅ migrations/2026-05-27-photos-type-common-collage.sql          │
# │      (DROP/CREATE photos_type_check с common_collage)              │
# │      Результат: 'Success. No rows returned'                        │
# │                                                                    │
# │ Никаких новых ожидающих миграций.                                  │
# │                                                                    │
# │ ═══════ СОСТОЯНИЕ ПРОЕКТА ═══════                                  │
# │                                                                    │
# │   • npx vitest run    → 758/758 passed, 0 failed                   │
# │   • npx tsc --noEmit  → пусто                                      │
# │   • npx next build    → зелёный                                    │
# │                                                                    │
# │   • В БД: 1 template_set okeybook-default (Белый), 36+ мастеров,   │
# │     включая J-Combined-Tail-4 с разумной геометрией                │
# │   • Активных альбомов нет, только тестовые                         │
# │   • Категория common_collage готова к использованию                │
# │   • Декоративный текст в S-Intro/S-Final-Soft-L работает           │
# │   • Personal section собирается (page_role/slot_capacity работают) │
# │                                                                    │
# │ ═══════ ОЧЕРЕДЬ ═══════                                              │
# │                                                                    │
# │ Закрыто в v178:                                                    │
# │   ✅ Категория common_collage (партнёр может загружать фото)       │
# │   ✅ Диагностика что J-Combined-Tail-4 уже работает                │
# │   ✅ Решение Сергея по подходу к мастерам сеток                    │
# │                                                                    │
# │ В планах:                                                          │
# │                                                                    │
# │ 1. **Когда Сергей загрузит N-Grid-Page-9** — код задача на 30-45  │
# │    мин (family-mapping + предпочтение в students.ts).              │
# │                                                                    │
# │ 2. **Когда Сергей дорисует 5 J-Combined-Tail** — никаких изменений │
# │    кода (family-mapping уже готов из РЭ.58). Только force-upload   │
# │    IDML и проверка что билдер использует правильные мастера для   │
# │    разных размеров хвоста.                                         │
# │                                                                    │
# │ 3. **Когда нужны J-Collage коллажи** — большая задача ~3-4 часа    │
# │    (см. раздел ЗАДАЧИ ДЛЯ КОДА выше). Делается ПЕРЕД тем как       │
# │    Сергей нарисует J-Collage-3/5/7/8.                              │
# │                                                                    │
# │ 4. **PDF EXPORT глобальных стилей + шрифтов** — pipeline пока не   │
# │    применяет НИ ОДНОГО override (size/color/halign/valign/font).   │
# │    ОТЛОЖЕНО до серьёзной работы с PDF.                             │
# │                                                                    │
# │ 5. **AI-помощник для партнёров** — большой проект.                 │
# │                                                                    │
# │ 6. **АДАПТАЦИЯ ПОД РАЗНЫЕ ФОРМАТЫ ТИПОГРАФИЙ** — новая             │
# │    архитектурная задача (зафиксирована 27.05.2026 по обсуждению    │
# │    с Сергеем):                                                     │
# │                                                                    │
# │    КОНТЕКСТ:                                                       │
# │      Сейчас один template_set = один фиксированный размер страниц │
# │      (у Сергея okeybook-default = 226×288 мм). Если партнёр        │
# │      печатает в типографии с другим форматом — система ничего не  │
# │      делает, PDF выходит исходного размера. Это работает только   │
# │      если все типографии используют идентичный формат.            │
# │                                                                    │
# │    КЛЮЧЕВЫЕ ТРЕБОВАНИЯ (от Сергея):                                │
# │      • Пропорции ФОТОГРАФИЙ сохраняются всегда (это уже работает  │
# │        через fit: fill_proportional — никаких stretch)             │
# │      • Пропорции СЛОТОВ должны сохраняться — круги остаются       │
# │        кругами, квадраты квадратами                                │
# │      • Геометрия декоративных элементов (фоновые узоры, рамки)   │
# │        не должна искажаться                                        │
# │                                                                    │
# │    ОБСУЖДЁННЫЕ ПОДХОДЫ:                                            │
# │      Подход A — равномерное масштабирование (uniform scale):       │
# │        Сжимает всё под новый размер. Безопасно ТОЛЬКО при очень   │
# │        близких пропорциях страниц (разница < 1%). Иначе круги     │
# │        деформируются в эллипсы.                                    │
# │                                                                    │
# │      Подход B — отдельный IDML под каждый формат:                  │
# │        Дизайнер рисует второй IDML под конкретный размер. Самый   │
# │        качественный, но дорого в производстве. Подходит для       │
# │        форматов с сильно отличающимися пропорциями (> 10%).        │
# │                                                                    │
# │      Подход C — smart-adapt с правилами (отвергнут):              │
# │        Сложная система с правилами '/если страница уже, слот     │
# │        сжать справа'. Не рекомендую — слишком много edge cases.  │
# │                                                                    │
# │      Подход D — фрейминг с центрированием (предложил Сергей):     │
# │        Слоты НЕ масштабируются, остаются той же геометрии.        │
# │        Фон страницы обрезается/расширяется. Композиция            │
# │        центрируется относительно новых границ.                    │
# │        Идеально сохраняет геометрию слотов. Работает когда        │
# │        целевой формат МЕНЬШЕ исходного с близкими пропорциями.    │
# │        Не работает когда целевой больше или когда нужно           │
# │        одновременно увеличить и обрезать по разным осям.         │
# │                                                                    │
# │      Подход E — анизотропное по одной оси + центрирование         │
# │                  (предложил Сергей):                                │
# │        Выбираем 'ведущую' ось (X или Y), коэффициент масштаба    │
# │        диктует ОНА. Все элементы масштабируются на этот единый    │
# │        коэффициент (круги остаются кругами!). Разница по второй  │
# │        оси компенсируется через центрирование (белые поля или   │
# │        обрезка фона).                                              │
# │        Работает для большинства реалистичных пар форматов с      │
# │        пропорциями отличающимися до 10%. Текст уменьшается       │
# │        пропорционально (важно проверять минимальный размер       │
# │        шрифта для имён).                                           │
# │                                                                    │
# │    ГИБРИДНАЯ СТРАТЕГИЯ (план реализации):                          │
# │      1. Партнёр указывает целевой формат при экспорте PDF         │
# │      2. Система сравнивает с исходным форматом template_set'а:    │
# │         • Разница пропорций < 2% → Подход D (фрейминг)            │
# │         • Разница 2-10%, обе стороны однонаправленно → Подход E   │
# │           с выбором оси меньшего коэффициента (минимальная         │
# │           обрезка/поля)                                            │
# │         • Разница 2-10% разнонаправленно → Подход E, выбираем     │
# │           ось 'меньшей правки'                                     │
# │         • Разница > 10% → предупреждение партнёру, предлагаем     │
# │           использовать отдельный template_set (Подход B)          │
# │                                                                    │
# │    ПРОДУКТОВОЕ ТРЕБОВАНИЕ К ДИЗАЙНЕРУ:                             │
# │      Слоты должны быть не впритык к краям — должны иметь         │
# │      отступ 5-10 мм от каждого края относительно bleed. Чтобы    │
# │      при адаптации (любой подход) не обрезались критические      │
# │      части композиции. Самая внешняя часть страницы — фон/декор, │
# │      который не страшно обрезать.                                  │
# │                                                                    │
# │    ВРЕМЯ КОДА: ~4-6 часов на полную реализацию + тестирование.    │
# │      • Параметр target_format_mm при PDF-export                   │
# │      • Логика выбора подхода (A/D/E/предупреждение)               │
# │      • Реализация D (фрейминг): простой shift + clip               │
# │      • Реализация E (анизотропное): scale + centering              │
# │      • Минимальный размер шрифта (защита от too-small)            │
# │      • UI выбора целевого формата в настройках альбома            │
# │                                                                    │
# │    КОГДА ДЕЛАТЬ:                                                   │
# │      Когда у Сергея появится ВТОРАЯ типография с отличающимся    │
# │      форматом и реальная необходимость экспорта под него.         │
# │      Сейчас ВСЕ заказы тестовые, типография одна — задача         │
# │      не актуальна. Зафиксирована в backlog'е чтобы при появлении │
# │      необходимости не изобретать заново подходы.                   │
# │                                                                    │
# │    СВЯЗАННЫЕ ОБСУЖДЕНИЯ:                                           │
# │      • Сергей упомянул что список типографий есть, но сейчас не   │
# │        актуально — отложили.                                       │
# │      • В первую очередь надо ГРУППИРОВАТЬ типографии по           │
# │        пропорциям — если все используют похожие пропорции         │
# │        (например 1:1.27 ± 5%), достаточно одного IDML +           │
# │        Подход D/E. Если разные — нужны несколько template_set.    │
# │                                                                    │
# │ ═══════ КРИТИЧЕСКИЕ ЗАМЕТКИ ═══════                                │
# │                                                                    │
# │ 1. После force=true upload IDML все spread_templates удаляются и  │
# │    вставляются заново. Это значит ID мастеров меняются. Альбомы   │
# │    на старом template_set потеряют привязку к мастерам.            │
# │    В тестовом режиме не критично, в проде — versioning через      │
# │    новые slug.                                                     │
# │                                                                    │
# │ 2. distribution=Жадно с симметризацией работает так:               │
# │    25 учеников / Mini (12 макс) → 12+11+2 (а не 12+12+1)           │
# │    Билдер берёт ближайший большой J-Combined-Tail (Tail-4 для      │
# │    хвоста 2). Когда появятся Tail-2/-3, будет выбирать optimal.    │
# │                                                                    │
# │ 3. Партнёр может загружать фото в common_collage прямо сейчас,    │
# │    но они НЕ используются билдером (нет мастеров и нет логики).   │
# │    Это OK — фото сохраняются на будущее, когда механика будет     │
# │    готова.                                                         │
# │                                                                    │
# │ 4. J-Combined-Tail-4 уже нарисован в IDML и работает. Геометрия   │
# │    в БД (через парсер) — координаты из реального IDML Сергея, не  │
# │    миграционная заглушка.                                          │
# │                                                                    │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО В V177 (27.05.2026 — РЭ.56-58 + cleanup)                │
# │                                                                    │
# │ 5 коммитов: декоративный текст из IDML + чистка прототипов +       │
# │ восстановление работы Personal section + UX мелочи. Большой день   │
# │ — закрыта инфраструктура для работы партнёра с готовыми мастерами. │
# │                                                                    │
# │ ═══════ feat 353f7e7 (РЭ.56) — default_text из IDML ═══════        │
# │                                                                    │
# │ Сергей задал вопрос: 'У меня в некоторых макетах присутствует мой  │
# │ текст. Как сделать, чтобы он сохранялся как часть мастера? Например│
# │ S-Intro есть вступительный текст, Final есть финальный текст.'     │
# │                                                                    │
# │ Подход C (выбран после обсуждения вариантов A/B/C):                │
# │   Декоративный текст хранится в IDML как обычный фрейм со Script   │
# │   Label. Партнёр в InDesign проставляет уникальные имена (например │
# │   static_text_1, static_text_2). Парсер читает <Content> из IDML и │
# │   сохраняет в placeholder.default_text. Builder использует как     │
# │   initial value в instance.data. Канвас показывает с возможностью  │
# │   править / удалять.                                               │
# │                                                                    │
# │ Изменения:                                                         │
# │   • lib/idml-converter/extract-styles.ts:                          │
# │     - StoryEntry +content?: string                                 │
# │     - Новый XMLParser с preserveOrder=true (нужен для правильного  │
# │       порядка Content vs Br — обычный парсер группирует одноимённые│
# │       теги в массивы, теряя последовательность)                    │
# │     - Функция extractStoryContent(xml) — рекурсивный walker        │
# │     - StyleResolver +resolveTextContent(storyId)                   │
# │   • lib/idml-converter/extract-geometry.ts:                        │
# │     text-placeholder получает default_text из resolveTextContent.  │
# │   • lib/rule-engine/sections/shared.ts:                            │
# │     bindOverrideMasterPlaceholders расширен — для text-placeholder │
# │     'ов без binding записывает default_text из IDML.               │
# │   • app/app/_components/AlbumSpreadCanvas.tsx:                     │
# │     при рендере text различает 'ключ отсутствует' (используем      │
# │     default_text) vs 'ключ есть null/empty' (партнёр стёр).        │
# │   • PDF pipeline уже умел fallback (lib/pdf-export/pipeline.ts:352)│
# │     — никаких изменений не потребовалось.                          │
# │                                                                    │
# │ ═══════ cleanup 418cd29 — удаление balance прототипов ═══════      │
# │                                                                    │
# │ После того как Сергей удалил test-balance-grid и test-balance-     │
# │ grid12 template_sets из БД через SQL DELETE, эти страницы и        │
# │ seed SQL были не нужны:                                            │
# │   • app/super/balance-prototype/page.tsx                           │
# │   • app/super/balance-grid12-prototype/page.tsx                    │
# │   • test-balance-grid12.sql                                        │
# │   • test-balance-template.sql                                      │
# │                                                                    │
# │ lib/balance-overrides/ ОСТАВЛЕН — это рабочий код движка           │
# │ балансировки.                                                      │
# │                                                                    │
# │ ═══════ fix 2d40343 (РЭ.57) — J-Quarter в палитре + default_text  │
# │                              в soft-intro/soft-final auto-режиме ═══│
# │                                                                    │
# │ Два мелких бага обнаружены при первом полном тесте после загрузки │
# │ нового IDML:                                                       │
# │                                                                    │
# │ 1. J-Quarter-Left и J-Quarter-Right не появлялись в JMasterPicker  │
# │    (модалка выбора мастера общего раздела). classifyMaster имел    │
# │    'quarterCount >= 4', но в постраничной модели у J-Quarter-*     │
# │    по 2 quarterphoto на странице (4 — это на разворот). Мастера   │
# │    попадали в категорию 'other' и не показывались.                 │
# │                                                                    │
# │    Фикс:                                                           │
# │      • classifyMaster: '>= 2' вместо '>= 4'                        │
# │      • CAPACITY_LABELS.quarter: '2 фото по 1/4' (отражает реальное │
# │        число фото на странице, не на развороте)                    │
# │                                                                    │
# │ 2. Декоративный текст не попадал в instance.data на S-Intro и      │
# │    S-Final-Soft-L в auto-режиме. Причина: в soft-intro.ts и        │
# │    soft-final.ts автоматическая ветка имеет узкую логику — цикл   │
# │    смотрит только classphotoframe и делает break. default_text-   │
# │    fallback из bindOverrideMasterPlaceholders не применяется.      │
# │                                                                    │
# │    Фикс:                                                           │
# │      • soft-intro.ts (auto-режим): после break добавлен второй    │
# │        цикл по всем placeholder'ам. Если type === 'text' &&        │
# │        default_text задан && нет binding'а — пишем default_text.   │
# │      • soft-final.ts (auto-режим): тот же fallback.                │
# │                                                                    │
# │ ═══════ fix cb53be7 (РЭ.58) — парсер заполняет page_role +         │
# │                               slot_capacity + applies_to_configs ══│
# │                                                                    │
# │ КРИТИЧНЫЙ БАГ — Personal section не собирался у Сергея, 24 одинак- │
# │ овых warning'а 'students_master_not_found' для E-Universal-Right.  │
# │                                                                    │
# │ Корневая причина: при загрузке IDML парсер заполнял только новые   │
# │ rule engine поля (family_id, page_type, density, params), но НЕ    │
# │ заполнял legacy-поля (page_role, slot_capacity, applies_to_configs)│
# │ которыми пользуется движок учеников через findStudentMaster и     │
# │ findStudentGridMaster.                                             │
# │                                                                    │
# │ После загрузки IDML колонки page_role и slot_capacity оставались  │
# │ NULL → движок не мог найти ни одного мастера учеников → Personal  │
# │ section вообще не собирался у партнёров.                           │
# │                                                                    │
# │ Архитектурный долг от РЭ.21: переходили на rule engine, ввели      │
# │ новые поля, но старые забыли проставлять.                          │
# │                                                                    │
# │ Решение: расширил жёсткую таблицу маппинга в                       │
# │ lib/idml-converter/family-mapping.ts.                              │
# │                                                                    │
# │ Для каждого из 30 мастеров ТЗ v1.5 + 6 J-Combined-Tail стабов     │
# │ теперь указано:                                                    │
# │   • page_role — 'student_left' / 'student_right' / 'student_grid'  │
# │                 / 'teacher_left' / 'teacher_right' / 'common' /    │
# │                 'intro' / 'final'                                  │
# │   • slot_capacity — JSONB { students, photos_friend, has_quote,    │
# │                 has_portrait, has_name, photos_full, photos_half,  │
# │                 photos_quarter, photos_sixth, photos_collage,      │
# │                 head_teacher, teachers }                           │
# │   • applies_to_configs — [] (универсальные)                        │
# │                                                                    │
# │ Значения зафиксированы по fixtures из тестов                       │
# │ (sections-students-page-semantic.test.ts:115-175).                 │
# │                                                                    │
# │ Конкретно по мастерам:                                             │
# │   • E-Max-Left:       students=1, photos_friend=0, has_quote=false,│
# │                       has_portrait=true, has_name=true             │
# │   • E-Max-Right:      students=1, photos_friend=4, has_quote=true, │
# │                       has_portrait=false, has_name=false           │
# │   • E-Universal-*:    students=1, photos_friend=2, has_quote=true, │
# │                       has_portrait=true, has_name=true             │
# │   • E-Standard-*:     students=1, photos_friend=0, has_quote=true, │
# │                       has_portrait=true, has_name=true             │
# │   • M-Grid-Page:      students=4, photos_full=0, has_quote=true    │
# │   • L-Grid-Page:      students=6, photos_full=0, has_quote=false   │
# │   • N-Grid-Page:      students=12, photos_full=0, has_quote=false  │
# │   • M-Combined-Page:  students=2, photos_full=1                    │
# │   • L-Combined-Page:  students=3, photos_full=1                    │
# │   • N-Combined-Page:  students=4, photos_full=1                    │
# │   • F-Head-*:         page_role='teacher_left', head_teacher=1     │
# │                       +teachers (0/4/8 для WithPhoto/SmallGrid/    │
# │                       LargeGrid)                                   │
# │   • G-Teachers-*:     page_role='teacher_right', teachers=9/12/16  │
# │   • G-FullClass/Half: page_role='teacher_right', photos_full/half  │
# │   • J-*:              page_role='common', photos по типу мастера   │
# │   • S-Intro/Final:    page_role='intro'/'final', photos_full=1     │
# │   • J-Combined-Tail-*: page_role='student_grid', students=2/3/4,   │
# │                       photos_full=1                                │
# │                                                                    │
# │ Изменения:                                                         │
# │   • lib/idml-converter/family-mapping.ts:                          │
# │     - FamilyMapping interface +page_role +slot_capacity +applies_  │
# │       to_configs                                                   │
# │     - Импорт типов PageRole и SlotCapacity из album-builder/types  │
# │     - Все 36 записей MAPPING получили эти три поля                 │
# │   • lib/idml-converter/upload.ts:                                  │
# │     INSERT в spread_templates новых полей теперь не NULL'ятся,     │
# │     а берутся из mapping.                                          │
# │                                                                    │
# │ Сергей тестировал: ✅ Personal section собрался корректно.         │
# │                                                                    │
# │ ═══════ fix 295807b (РЭ.56.b) — рекурсивный поиск Story в IDML ════│
# │                                                                    │
# │ Серьёзный баг в РЭ.56: декоративный текст из IDML НЕ попадал в БД │
# │ даже когда партнёр правильно проставил Script Labels.              │
# │                                                                    │
# │ КОРНЕВАЯ ПРИЧИНА:                                                  │
# │   Реальные IDML файлы используют namespace prefix idPkg для        │
# │   корневых элементов. Структура XML:                               │
# │     <idPkg:Story xmlns:idPkg="...">                                │
# │       <Story Self="...">                                           │
# │         <ParagraphStyleRange>                                      │
# │           <CharacterStyleRange>                                    │
# │             <Content>текст</Content>                               │
# │                                                                    │
# │   fast-xml-parser в preserveOrder=true парсит это в:               │
# │     [                                                              │
# │       { 'idPkg:Story': [                                           │
# │           { Story: [...] }  ← вложенно!                            │
# │       ]}                                                           │
# │     ]                                                              │
# │                                                                    │
# │   Walker в extractStoryContent (РЭ.56) искал Story ТОЛЬКО на       │
# │   верхнем уровне массива — натыкался на idPkg:Story и не находил   │
# │   вложенный Story. Возвращал пустую строку, content=undefined,    │
# │   default_text не записывался.                                     │
# │                                                                    │
# │ РЕШЕНИЕ:                                                           │
# │   Заменил верхнеуровневый поиск на рекурсивную функцию             │
# │   findStoryArray. Она обходит все массивы во всех узлах, возвращает│
# │   массив дочерних узлов первого встреченного 'Story' тега на       │
# │   любой глубине. Устойчиво к любой обёртке (idPkg:Story, Document, │
# │   или произвольному nesting'у).                                    │
# │                                                                    │
# │ Сергей тестировал после фикса: ✅ Текст в S-Intro отобразился      │
# │ корректно как два редактируемых поля. Финальный текст в S-Final-   │
# │ Soft-L тоже работает.                                              │
# │                                                                    │
# │ ═══════ ОБСУЖДЕНИЯ И ПРОДУКТОВЫЕ РЕШЕНИЯ ═══════                   │
# │                                                                    │
# │ 1. Сергей подтвердил все 30 мастеров из ТЗ v1.5 нарисованы. Плюс   │
# │    6 J-Combined-Tail стабов в БД (РЭ.37.3) — арт ещё не нарисован  │
# │    в InDesign. Это **открытая** задача РЭ.37.8.                    │
# │                                                                    │
# │ 2. Сергей озвучил пожелание: дополнительные мастера общего раздела │
# │    на 2/3/4/5/6/7/8 фото (горизонтальные и вертикальные). Не       │
# │    срочно, отложили — это новый функционал, не баг. Возникнет      │
# │    продуктовый вопрос: какой пул фото используют? Сейчас:          │
# │    common_full → 1, common_half → 2, common_quarter → 4 на         │
# │    разворот, common_sixth → 4-6 в коллаже. Возможно нужна новая    │
# │    категория common_collage или расширение существующих.           │
# │                                                                    │
# │ 3. Сергей объяснил про загрузку IDML (force=true vs новый slug):   │
# │    • force=true тот же slug → перезаписывает мастера, альбомы      │
# │      могут потерять привязку (template_id у мастеров меняется)     │
# │    • Новый slug → новый template_set рядом, старый альбомы целы    │
# │    • Когда заказы пойдут — лучше versioning через новые slug       │
# │    Сейчас тест, заказов нет, force=true спокойно.                  │
# │                                                                    │
# │ 4. Декоративный текст в IDML — простое правило: любой текстовый    │
# │    фрейм с уникальной Script Label попадает в систему как редакти- │
# │    руемое поле с default_text. Зарезервированные имена (которые    │
# │    система использует для своих данных): headtextframe,            │
# │    headteachername, headteacherrole, studentname, studentquote,    │
# │    teachername_N, teacherrole_N, и т.п.                            │
# │                                                                    │
# │ ═══════ КОММИТЫ ЗА V177 (6 шт) ═══════                              │
# │                                                                    │
# │   353f7e7 — feat РЭ.56: default_text — декоративный текст из IDML │
# │   418cd29 — cleanup: remove balance prototype pages and seed SQL  │
# │   2d40343 — fix РЭ.57: J-Quarter в палитре + default_text в auto  │
# │   cb53be7 — fix РЭ.58: парсер заполняет page_role+slot_capacity+  │
# │              applies_to_configs                                    │
# │   295807b — fix РЭ.56.b: рекурсивный поиск Story (idPkg:Story)    │
# │   (этот) — docs: context v177                                      │
# │                                                                    │
# │ ═══════ СОСТОЯНИЕ ПРОЕКТА ═══════                                  │
# │                                                                    │
# │   • npx vitest run    → 758/758 passed, 0 failed                   │
# │   • npx tsc --noEmit  → пусто                                      │
# │   • npx next build    → зелёный                                    │
# │                                                                    │
# │   • В БД: 1 template_set okeybook-default (Белый), 36 мастеров,    │
# │     layflat, 226×288 мм                                            │
# │   • Активных альбомов нет, только тестовые (Тест25)                │
# │   • Все 30 мастеров ТЗ v1.5 + 6 J-Combined-Tail стабов нарисованы  │
# │     в IDML. Декоративный текст в S-Intro/S-Final работает.         │
# │                                                                    │
# │ ═══════ ЧТО ДАЛЬШЕ ═══════                                          │
# │                                                                    │
# │ Закрыто в v177:                                                    │
# │   ✅ Декоративный текст из IDML (Подход C)                         │
# │   ✅ Personal section собирается (page_role/slot_capacity fix)     │
# │   ✅ J-Quarter в палитре общего раздела                            │
# │   ✅ Чистка балансе-прототипов                                     │
# │                                                                    │
# │ Очередь:                                                           │
# │                                                                    │
# │ 1. РЭ.37.8 — Сергей рисует J-Combined-Tail-* арт в IDML (6 шт:    │
# │    2/3/4 + -Right варианты для Medium/Light/Mini transition).      │
# │    Стабы уже в БД, метки нужны: studentportrait_1..N +             │
# │    classphotoframe (photo), studentname_1..N (text).               │
# │    N=2/3/4 для Tail-2/3/4 соответственно.                          │
# │                                                                    │
# │ 2. Дополнительные J-* варианты для общего раздела (пожелание       │
# │    Сергея: на 2/3/4/5/6/7/8 фото, горизонтальные и вертикальные). │
# │    Открытый продуктовый вопрос откуда брать фото — может потребо- │
# │    вать новой категории common_collage.                            │
# │                                                                    │
# │ 3. PDF EXPORT глобальных стилей + шрифтов — pipeline пока НЕ       │
# │    применяет НИ ОДНОГО override (size/color/halign/valign/font).   │
# │    ОТЛОЖЕНО по решению Сергея до серьёзной работы с PDF.           │
# │    Когда придёт: ~1-1.5 часа работы. Подгрузить                    │
# │    albums.text_style_overrides из БД в PdfRenderCtx, добавить     │
# │    detectTextStyleGroup + resolveFontSizeMult/Color/HAlign/VAlign/ │
# │    FontFamily. font-loader.ts уже готов к 12 ключам.               │
# │                                                                    │
# │ 4. AI-помощник для партнёров — большой отдельный проект.           │
# │                                                                    │
# │ 5. Названия мастеров в UI — обсуждение для подписей в селекторах. │
# │                                                                    │
# │ 6. РЭ.37.3.d (soft helpers Standard/Universal на soft) — по        │
# │    необходимости.                                                  │
# │                                                                    │
# │ 7. РЭ.44.a — улучшенный warning pages_underflow с активной         │
# │    ссылкой на редактор шаблона.                                    │
# │                                                                    │
# │ 8. handleReplaceFullPhoto — cast обрезает common_* типы до         │
# │    portrait/group/teacher. Edge case.                              │
# │                                                                    │
# │ ═══════ МИГРАЦИИ ДЛЯ ПРИМЕНЕНИЯ К ПРОДУ ═══════                    │
# │                                                                    │
# │ Никаких новых миграций в v177 — все изменения в коде, БД-схема    │
# │ не трогалась.                                                      │
# │                                                                    │
# │ Все миграции из v176 (text_style_overrides JSONB, symmetrize_      │
# │ students_tail_override) уже применены к проду.                     │
# │                                                                    │
# │ ═══════ КРИТИЧЕСКИЕ ЗАМЕТКИ ═══════                                │
# │                                                                    │
# │ 1. После любого force=true upload IDML альбомы которые уже на     │
# │    этом template_set ПОТЕРЯЮТ привязку к мастерам (template_id у  │
# │    spread_templates меняется при DELETE+INSERT). В тестовом       │
# │    режиме не критично — пересобрать. В проде потребуется          │
# │    versioning через новые slug.                                    │
# │                                                                    │
# │ 2. Page_role и slot_capacity заполнены из family-mapping.ts по    │
# │    fixtures из тестов. Если дизайнер изменит структуру мастера   │
# │    (например, добавит фото с друзьями в E-Standard-Left), нужно   │
# │    будет обновить таблицу маппинга — иначе фильтр в               │
# │    findStudentMaster не пропустит изменённый мастер.               │
# │                                                                    │
# │ 3. Декоративный текст: партнёр в IDML должен ставить Script        │
# │    Labels с УНИКАЛЬНЫМИ именами внутри одного мастера. Если в     │
# │    одном мастере два фрейма с label 'static_text' — один из них   │
# │    перезапишется (dedupeLabels добавляет суффикс или выкидывает). │
# │                                                                    │
# │ ═══════ КОНТЕКСТНАЯ ССЫЛКА НА КАТАЛОГ МАСТЕРОВ ═══════              │
# │                                                                    │
# │ Полный каталог 30 мастеров с метками — в                           │
# │ docs/templates/designer-tz-2026-05-16-v1.5.md                      │
# │                                                                    │
# │ Сводка категорий:                                                  │
# │   F (head-teacher):       4 мастера                                │
# │   G (subject-teachers):   3 мастера                                │
# │   G (class-photo):        2 мастера                                │
# │   E (max/univ/std):       6 мастеров                               │
# │   M (medium):             1 (параметрический)                      │
# │   L (light):              1 (параметрический)                      │
# │   N (mini):               1 (параметрический)                      │
# │   J (common-section):     7 мастеров                               │
# │   S (intro/final):        2 мастера                                │
# │   Combined:               3 мастера                                │
# │   ───────────────────────                                          │
# │   ВСЕГО:                  30 мастеров                              │
# │                                                                    │
# │ +6 J-Combined-Tail-* стабов (без арта, для transition combo).     │
# │                                                                    │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО В V176 (26.05.2026 — РЭ.55)                              │
# │                                                                    │
# │ 3 коммита: одна серия по выбору шрифтов партнёром в редакторе +    │
# │ один сопутствующий фикс canvas-рендера для повёрнутого текста.     │
# │                                                                    │
# │ ═══════ feat f4c0e89 (РЭ.55) — rotation_deg в canvas ═══════       │
# │                                                                    │
# │ КОНТЕКСТ:                                                          │
# │   Сергей: 'вертикальная надпись Классный руководитель должна идти  │
# │   вертикально вдоль длинной стороны портрета (90°), но в редакторе │
# │   рисуется горизонтально с переносами по буквам'.                  │
# │                                                                    │
# │ ДИАГНОСТИКА (вместе с Сергеем):                                    │
# │   • InDesign макет — text frame повёрнут через ItemTransform       │
# │     матрицу (rotation=-90° для headteacherrole). Скрин 1 и 2       │
# │     показывают разницу: rotation 0° vs 90° в Control Panel.        │
# │   • Парсер IDML (lib/idml-converter/extract-geometry.ts:            │
# │     rotationDeg) КОРРЕКТНО читает rotation из ItemTransform и      │
# │     сохраняет в placeholder.rotation_deg в БД. Сергей проверил     │
# │     через API: rotation_deg: -90 присутствует.                     │
# │   • PDF-export уже учитывает rotation_deg                          │
# │     (lib/pdf-export/text-shaping.ts и photo-embed.ts).             │
# │   • Canvas AlbumSpreadCanvas ИГНОРИРОВАЛ rotation_deg —            │
# │     единственное звено где не применялось.                         │
# │                                                                    │
# │ РЕШЕНИЕ — Konva rotation в TextSlot:                               │
# │   Placeholder.{x,y,width,height} в БД — ВИЗУАЛЬНЫЙ bbox после      │
# │   поворота (то что partner видит на странице). Konva <Text>        │
# │   рисует в нерёповёрнутой системе. Чтобы текст после rotation      │
# │   попал в визуальный bbox, передаём width/height с перестановкой   │
# │   и подбираем точку привязки.                                      │
# │                                                                    │
# │     rotation = -90 (CW):                                            │
# │       (x, y) = нижний-левый угол bbox,                              │
# │       width = height_mm, height = width_mm                          │
# │     rotation = +90 (CCW):                                           │
# │       (x, y) = верхний-правый угол bbox,                            │
# │       width/height тоже переставлены                                │
# │     rotation = 0 (или undefined):                                   │
# │       рендерим как раньше — обратной совместимости                  │
# │                                                                    │
# │ DOM-overlay (TextDropZone, TextInlineEditor) остаются на           │
# │ визуальном bbox без rotation — компромисс UX: партнёр видит        │
# │ вертикальный текст в режиме просмотра, при клике textarea          │
# │ открывается горизонтально в той же визуальной области (узкий       │
# │ вертикальный прямоугольник, в нём строчка горизонтального текста   │
# │ — для печати удобнее).                                             │
# │                                                                    │
# │ Сергей: ✅ 'С вертикальным текстом всё хорошо, всё вроде бы        │
# │ работает нормально.'                                               │
# │                                                                    │
# │ ═══════ СЕРИЯ РЭ.55 — выбор шрифта партнёром (2 коммита) ═══════   │
# │                                                                    │
# │ КОНТЕКСТ:                                                          │
# │   После РЭ.53/54 у партнёра есть точечный override (TextStylePanel │
# │   клик-на-текст) и глобальные стили (модалка '🎨 Стили текстов'),  │
# │   управляющие size + color + halign + valign. Размер шрифта        │
# │   управляется, но САМ ШРИФТ был зафиксирован: placeholder.font_     │
# │   family из IDML, не было возможности заменить.                    │
# │                                                                    │
# │ ОБСУЖДЕНИЕ С СЕРГЕЕМ:                                              │
# │   Q: Шрифты в новых макетах должны автоматически становиться       │
# │      опциями?                                                       │
# │   A: Curated подход вместо auto-import. 7 шрифтов из Google Fonts: │
# │      Noto Serif, PT Serif, Open Sans, Roboto, Montserrat, Caveat,  │
# │      Slimamif. Когда понадобится новый — добавляем сюда же         │
# │      (~5 минут на шрифт: TTF + @font-face + font-loader + AVAILABLE│
# │      _FONTS).                                                      │
# │   Q: Per-group выбор?                                              │
# │   A: Да, в каждую категорию (имена/цитаты/ФИО/должности).          │
# │   Q: Сразу показывать?                                             │
# │   A: Да, в виде компактного dropdown.                              │
# │                                                                    │
# │ АРХИТЕКТУРНОЕ РЕШЕНИЕ:                                             │
# │   • Список фиксированный curated в lib/text-style/fonts.ts.        │
# │   • Дизайнер в IDML может использовать ЛЮБОЙ шрифт — placeholder.  │
# │     font_family передаётся как строка, всё остаётся работать       │
# │     'из коробки'. Партнёр НЕ обязан менять — это override.         │
# │   • Если партнёр ХОЧЕТ заменить — выбирает из curated 7.           │
# │   • Лицензионная чистота: open-source только (SIL OFL / Apache 2.0).│
# │   • Гарантия что один и тот же шрифт работает и в редакторе (CSS)  │
# │     и в PDF (font-loader).                                         │
# │                                                                    │
# │ feat d981b8b (РЭ.55.a) — инфраструктура:                          │
# │   • +7 TTF файлов в public/fonts/ (~3.6 МБ):                       │
# │     - PTSerif-Regular.ttf, PTSerif-Bold.ttf                        │
# │     - Roboto-Regular.ttf, Roboto-Bold.ttf                          │
# │     - Montserrat-Regular.ttf, Montserrat-Bold.ttf                  │
# │     - Caveat-Regular.ttf                                           │
# │     Все из Google Fonts через raw.githubusercontent.com.           │
# │   • app/globals.css — +7 новых @font-face деклараций.              │
# │   • lib/pdf-export/font-loader.ts — FontKey: 5 → 12 ключей,        │
# │     FONT_FILES маппинги, resolveKey распознаёт новые семейства     │
# │     ('pt serif', 'roboto', 'montserrat', 'caveat'). Готов к PDF.   │
# │   • lib/text-style/fonts.ts (новый файл):                          │
# │     - FontFamilyOption interface { family, label, category, hint } │
# │     - AVAILABLE_FONTS массив (7 элементов, порядок = порядок в UI) │
# │     - isAvailableFont(s) — case-insensitive проверка               │
# │     - parseFontFamily(v) — возвращает каноническое имя или null    │
# │     - resolveFontFamily(point, global) — каскад точка→глобал→null  │
# │   • 19 новых тестов в lib/text-style/__tests__/fonts.test.ts.      │
# │   • TextStyleGroupOverride расширен на font_family?: string | null.│
# │   • parseAlbumTextStyleOverrides учитывает font_family в JSONB.    │
# │   • 12 старых тестов groups.test.ts обновлены — теперь возвращаемый│
# │     объект включает font_family: null.                             │
# │                                                                    │
# │ feat 0e80fe2 (РЭ.55.b) — UI + canvas каскад:                       │
# │   • TextStylePanel.tsx:                                            │
# │     - Props +fontFamilyOverride, +templateFontFamily, +font в      │
# │       onChange сигнатуре.                                          │
# │     - PANEL_HEIGHT 320 → 380.                                      │
# │     - State fontFamily + handleFontSelect.                         │
# │     - emitChange шлёт 5 параметров (включая font).                 │
# │     - Все existing handlers (size/color/align/reset) передают      │
# │       fontFamily через emitChange — чтобы не сбрасывать его.       │
# │     - isDefault учитывает fontFamily.                              │
# │     - Новая UI секция 'Шрифт' перед 'Размер':                     │
# │       • <select> с 'Из шаблона (<имя>)' первой строкой             │
# │       • Опции AVAILABLE_FONTS — каждая отрисована своим шрифтом    │
# │         (style={fontFamily: f}) для preview прямо в списке         │
# │       • Кнопка ↺ справа от заголовка для сброса                    │
# │       • Сам select-бокс отрисован выбранным шрифтом                │
# │   • app/app/album/[id]/layout/page.tsx:                            │
# │     - +import parseFontFamily.                                     │
# │     - handleTextStyleChange принимает font?: string | null →       │
# │       пишет в __font__<label> (или удаляет ключ).                  │
# │     - render TextStylePanel: парсит __font__<label>, ищет в шаблоне│
# │       placeholder.font_family для подсказки 'Из шаблона (...)'.    │
# │   • AlbumTextStylesModal.tsx:                                      │
# │     - +import AVAILABLE_FONTS.                                     │
# │     - updateGroup расширен на font_family. Условие удаления       │
# │       группы: все 5 полей null (раньше 4).                         │
# │     - Новая UI секция 'Шрифт' в каждой карточке группы.            │
# │   • AlbumSpreadCanvas.tsx — каскад в canvas:                       │
# │     - +import parseFontFamily, resolveFontFamily.                  │
# │     - TextSlot и TextInlineEditor: +fontFamilyOverride prop.       │
# │     - finalFontFamily = fontFamilyOverride ?? placeholder.font_    │
# │       family. Применён в Konva <Text fontFamily> и в textarea      │
# │       style.fontFamily.                                            │
# │     - Места рендера: парсят __font__<label>, считают groupOv,      │
# │       резолвят через resolveFontFamily.                            │
# │                                                                    │
# │ Сергей: ✅ 'Всё отлично работает. Мне очень понравилось. Спасибо.' │
# │                                                                    │
# │ ═══════ КОММИТЫ ЗА V176 (4 шт) ═══════                              │
# │                                                                    │
# │   f4c0e89 — feat РЭ.55:    rotation_deg в canvas (вертикальный    │
# │                            текст headteacherrole)                  │
# │   d981b8b — feat РЭ.55.a:  curated шрифты + регистрация + типы    │
# │   0e80fe2 — feat РЭ.55.b:  UI выбора шрифта + canvas каскад       │
# │   (этот) — docs: context v176                                      │
# │                                                                    │
# │ ═══════ ОЧЕРЕДЬ НА БУДУЩЕЕ ═══════                                 │
# │                                                                    │
# │ Закрыто в v176:                                                    │
# │   ✅ Вертикальный текст в canvas (RP.55 / rotation_deg)           │
# │   ✅ Выбор шрифта точечно (TextStylePanel)                         │
# │   ✅ Выбор шрифта глобально (AlbumTextStylesModal по группам)      │
# │   ✅ 7 curated шрифтов в инфраструктуре                            │
# │                                                                    │
# │ Остаётся:                                                          │
# │                                                                    │
# │ 1. PDF EXPORT глобальных стилей + шрифтов — pdf-pipeline пока НЕ   │
# │    использует НИ ОДНОГО override:                                  │
# │      • text_style_overrides (размер/цвет глобал/halign/valign глобал)│
# │      • точечные halign/valign из data[__halign__<label>] etc.      │
# │      • font_family override (ни глобал ни точка)                   │
# │    ОТЛОЖЕНО ПО РЕШЕНИЮ СЕРГЕЯ: 'я пока вообще не пользовался       │
# │    экспортом, потому что мы ещё занимаемся редактором. Я до сих    │
# │    пор не сделал все мастеры. Дизайнерские шаблоны (с фоном/       │
# │    рамками) ни одного ещё не загружали. После всех мастеров буду   │
# │    делать сохранение и экспорт в PDF и JPEG.'                      │
# │                                                                    │
# │    КОГДА ВРЕМЯ ПРИДЁТ:                                              │
# │      • Pipeline уже знает про точечные fontSize/color: смотри      │
# │        lib/pdf-export/pipeline.ts:363 — parseFontSizeMult+parseColor│
# │      • Нужно: подгрузить albums.text_style_overrides из БД в       │
# │        контекст; прокинуть AlbumTextStyleOverrides через           │
# │        PdfRenderCtx; добавить в обработчике текста detectTextStyle │
# │        Group + resolveFontSizeMult/Color/HAlign/VAlign/FontFamily; │
# │        font-loader.ts уже готов к 12 ключам через РЭ.55.a.         │
# │      • Время: ~1-1.5 часа на полный охват.                         │
# │                                                                    │
# │ 2. МАСТЕРЫ (текущий блокер Сергея) — Сергей сейчас доделывает      │
# │    мастеры для разных конфигураций. В частности упомянул '3 фото   │
# │    папки 3-м'. Без всех мастеров не двинется загрузка дизайнерских │
# │    шаблонов и потом экспорт.                                       │
# │                                                                    │
# │ 3. ДИЗАЙНЕРСКИЕ ШАБЛОНЫ С ФОНАМИ И РАМКАМИ — после мастеров.       │
# │    Может потребовать доработки IDML парсера если в макетах есть    │
# │    сложные элементы (PSD-эффекты, прозрачности, эффекты теней     │
# │    и т.п.). Сергей: 'до сих пор мы еще ни разу не загружали ни    │
# │    одного дизайнерского шаблона'.                                  │
# │                                                                    │
# │ 4. AI-помощник для партнёров — большой отдельный проект.           │
# │    Claude API + RAG + state UI + deep linking.                     │
# │                                                                    │
# │ 5. Названия мастеров — обсуждение для подписей в UI селекторах.    │
# │                                                                    │
# │ 6. РЭ.37.3.d (soft helpers для Standard/Universal на soft) —       │
# │    по необходимости. Сергей не планирует в ближайшее время.        │
# │                                                                    │
# │ 7. РЭ.44.a — улучшенный warning для pages_underflow. Активная      │
# │    ссылка на редактор шаблона. Без auto-fill.                      │
# │                                                                    │
# │ 8. Замена common-фото через handleReplaceFullPhoto: cast в         │
# │    page.tsx обрезает common_* типы до 'portrait'|'group'|          │
# │    'teacher'|null с fallback 'portrait'. Edge case.                │
# │                                                                    │
# │ ═══════ МИГРАЦИИ ДЛЯ ПРИМЕНЕНИЯ К ПРОДУ ═══════                    │
# │                                                                    │
# │ В Supabase Studio (применить ОБЯЗАТЕЛЬНО до использования стилей,  │
# │ если уже не применил из v175):                                     │
# │                                                                    │
# │   -- РЭ.46 (из v173): override симметризации на альбоме            │
# │   ALTER TABLE albums                                                │
# │     ADD COLUMN IF NOT EXISTS                                        │
# │       symmetrize_students_tail_override boolean DEFAULT NULL;       │
# │                                                                    │
# │   -- РЭ.50 (из v174): cleanup мёртвых presets                      │
# │   DELETE FROM presets WHERE id IN (                                 │
# │     'custom-qgrz75n3', 'custom-l34kwu6p', 'custom-vrfxcuqi'         │
# │   );                                                                │
# │                                                                    │
# │   -- РЭ.53 (из v175): глобальные стили текстов                     │
# │   ALTER TABLE albums                                                │
# │     ADD COLUMN IF NOT EXISTS                                        │
# │       text_style_overrides JSONB DEFAULT NULL;                      │
# │                                                                    │
# │ Никаких новых миграций в v176 — РЭ.55 хранит font_family в той же  │
# │ JSONB колонке text_style_overrides (глобально) и в data ключе      │
# │ __font__<label> в spread.data (точечно).                           │
# │                                                                    │
# │ ═══════ СОСТОЯНИЕ ПРОЕКТА ═══════                                  │
# │                                                                    │
# │   • npx vitest run    → 758/758 passed, 0 failed                   │
# │   • npx tsc --noEmit  → пусто                                      │
# │   • npx next build    → зелёный                                    │
# │                                                                    │
# │ ═══════ КУРАТЕД СПИСОК ШРИФТОВ ═══════                              │
# │                                                                    │
# │ Single source of truth — lib/text-style/fonts.ts AVAILABLE_FONTS.  │
# │ Любое добавление нового шрифта требует синхрона В ТРЁХ МЕСТАХ:     │
# │                                                                    │
# │   1. public/fonts/<Name>-<Weight>.ttf — файл (~300-500 KB)         │
# │   2. app/globals.css — @font-face declaration                      │
# │   3. lib/pdf-export/font-loader.ts — FontKey + FONT_FILES +        │
# │      resolveKey                                                    │
# │   4. lib/text-style/fonts.ts — AVAILABLE_FONTS объект              │
# │                                                                    │
# │ Текущий список (7 семейств / 12 файлов):                           │
# │   Noto Serif (regular + bold)    serif       — основной            │
# │   PT Serif (regular + bold)      serif       — книжный             │
# │   Open Sans (regular + italic)   sans        — универсальный       │
# │   Roboto (regular + bold)        sans        — технический         │
# │   Montserrat (regular + bold)    sans        — геометрический      │
# │   Caveat (regular)               handwritten — рукописный          │
# │   Slimamif (medium)              decorative  — для детских макетов │
# │                                                                    │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО В V175 (26.05.2026 — РЭ.52/53/54)                       │
# │                                                                    │
# │ 13 коммитов 3 серии: попапы редактора, глобальные стили текстов,  │
# │ выравнивание + табы фото. Большая UX-итерация на основе фидбека    │
# │ Сергея при тестировании на Тест25.                                 │
# │                                                                    │
# │ ═══════ СЕРИЯ РЭ.52 — попапы редактора (3 коммита) ═══════        │
# │                                                                    │
# │ КОНТЕКСТ: TextStylePanel и PhotoTransformPanel позиционировались  │
# │ напрямую по клик-координатам, частично перекрывая объект          │
# │ который партнёр пытается редактировать. Также при изменении       │
# │ цвета в TextStylePanel срабатывал blur textarea → панель          │
# │ закрывалась моментально.                                          │
# │                                                                    │
# │ fix ddca5d0 (РЭ.52): попап в правый сайдбар (top-right fixed) +   │
# │   preventDefault на mouseDown для предотвращения blur textarea.   │
# │   Сергей: 'слайдер не работает, окошко далеко на мониторе'.       │
# │   Был неправ — top-right плохо для UX, preventDefault блокировал  │
# │   drag input range.                                                │
# │                                                                    │
# │ fix a7d5d14 (РЭ.52.b): откат top-right → умное позиционирование   │
# │   относительно ТОЧКИ КЛИКА (clientX/Y + 30px). Фикс blur через    │
# │   relatedTarget в handleBlur — игнорируем blur если фокус ушёл    │
# │   в panel (data-text-style-panel='true' marker).                  │
# │   preventDefault снят с onMouseDown — drag слайдера работает.     │
# │   Сергей: 'окно перекрывает текст/фото'.                          │
# │                                                                    │
# │ fix c80c8e0 (РЭ.52.c): позиционирование от ГРАНИЦ placeholder'а   │
# │   (rect.right/top/left из getBoundingClientRect, не clientX/Y).   │
# │   Логика: пробуем справа от rightEdge → если не помещается, слева │
# │   от leftEdge → fallback на левый край экрана. По вертикали       │
# │   выравниваем по topEdge. Panel НИКОГДА не перекрывает объект.    │
# │   Сергей: ✅ 'Очень классно получилось, всё то, что надо.'        │
# │                                                                    │
# │ ИЗМЕНЕНИЯ:                                                         │
# │   • app/app/_components/TextStylePanel.tsx — Props clientX/Y →    │
# │     rightEdge/topEdge/leftEdge, smart-position логика.            │
# │   • app/app/_components/PhotoTransformPanel.tsx — то же.          │
# │   • app/app/_components/AlbumSpreadCanvas.tsx — DropZone (фото) и │
# │     TextDropZone передают rect.right/top/left вместо clientX/Y;   │
# │     TextInlineEditor.handleBlur с relatedTarget guard.            │
# │   • app/app/album/[id]/layout/page.tsx — state panel'ов        │
# │     clientX/Y → rightEdge/topEdge/leftEdge; handlers сигнатуры.   │
# │                                                                    │
# │ ═══════ СЕРИЯ РЭ.53 — глобальные стили текстов (4 коммита) ═══════│
# │                                                                    │
# │ ЗАПРОС СЕРГЕЯ: 'Нужно сделать общие настройки изменения текста.   │
# │ Чтобы один раз настроить все имена во всём альбоме. То же —       │
# │ размеры текстов на личных страницах, ФИО и должности учителей.'   │
# │                                                                    │
# │ ARCHITECTURE:                                                      │
# │   БД: новая колонка albums.text_style_overrides (JSONB nullable). │
# │   Структура: { <group>: { size_pct, color, halign?, valign? } }   │
# │   Группы (4): studentname, studentquote, teachername, teacherrole.│
# │   КАСКАД: точечный override (data[__fontSize__<label>] etc.)      │
# │   побеждает глобальный → fallback на placeholder defaults из IDML.│
# │                                                                    │
# │ feat 20bfd3e (РЭ.53.a) — БД + типы + API:                         │
# │   • Миграция migrations/2026-05-26-albums-text-style-overrides.sql│
# │     ALTER TABLE albums ADD COLUMN text_style_overrides JSONB.     │
# │   • lib/text-style/groups.ts: TEXT_STYLE_GROUPS, типы             │
# │     TextStyleGroup / TextStyleGroupOverride / AlbumTextStyleOverrides,│
# │     parseAlbumTextStyleOverrides (безопасный JSONB парсер),       │
# │     detectTextStyleGroup (label → group),                         │
# │     resolveFontSizeMult / resolveColor (каскад точка→глобал→null).│
# │   • API tenant.update_album allowedFields += 'text_style_overrides'│
# │   • 23 теста в lib/text-style/__tests__/groups.test.ts.           │
# │                                                                    │
# │ feat b4f741a (РЭ.53.b) — применение в canvas:                     │
# │   • page.tsx подтягивает album.text_style_overrides → state.      │
# │   • AlbumSpreadCanvas принимает textStyleOverrides prop.          │
# │   • TextSlot (Konva) и TextInlineEditor применяют каскад.         │
# │                                                                    │
# │ feat 6d115b4 (РЭ.53.c) — UI модалка:                              │
# │   • app/app/_components/AlbumTextStylesModal.tsx — модалка с 6   │
# │     секциями по группам. Slider 50-200%, палитра 10 цветов,       │
# │     кнопка '↺ По умолчанию' в каждой группе.                      │
# │   • Optimistic preview через onPreview — partner видит результат  │
# │     на canvas пока настраивает.                                   │
# │   • Кнопка '🎨 Стили текстов' в toolbar редактора.                │
# │                                                                    │
# │ feat e751b95 (РЭ.53.d) — компактная + минус 2 группы:             │
# │   Сергей: 'занимает всё пространство, headteachername и           │
# │   headtextframe — в единственном экземпляре, проще локально.'    │
# │   • TEXT_STYLE_GROUPS: 6 → 4 (убрали headteachername, headtextframe).│
# │   • detectTextStyleGroup для этих labels → null (не покрыты      │
# │     глобальными — fallback на placeholder + точечный override).   │
# │   • Модалка max-w-3xl → max-w-2xl, grid 2×2 на широком экране,    │
# │     меньшие swatch'и (24px), компактнее везде. Hints заменены     │
# │     на моноширинные labels (studentname_N).                       │
# │                                                                    │
# │ ⚠️ МИГРАЦИЯ ДЛЯ ПРОДА:                                             │
# │   ALTER TABLE albums ADD COLUMN IF NOT EXISTS                     │
# │     text_style_overrides JSONB DEFAULT NULL;                      │
# │                                                                    │
# │ ═══════ СЕРИЯ РЭ.54 — выравнивание + табы (6 коммитов) ═══════    │
# │                                                                    │
# │ ЗАПРОСЫ СЕРГЕЯ:                                                   │
# │   1. 'Можно ли в панель стилей текстов ставить настройку         │
# │      центрирования относительно фрейма? Верх-середина-низ и       │
# │      лево-середина-право — как в Word.'                           │
# │   2. 'В палитре фотографий сделать вкладки по категориям.         │
# │      Нажимаешь Портреты — только портреты, и т.д.'                │
# │                                                                    │
# │ feat 9480249 (РЭ.54.a) — H + V align в TextStylePanel:            │
# │   • lib/text-style/groups.ts расширен:                            │
# │     - TextStyleGroupOverride += halign?/valign?                   │
# │     - Новые типы TextHAlign / TextVAlign                          │
# │     - parseHAlign / parseVAlign — валидация enum, case-insensitive│
# │     - resolveHAlign / resolveVAlign — каскад как для size/color   │
# │     - parseAlbumTextStyleOverrides учитывает halign/valign в JSONB│
# │   • TextStylePanel: новые initial props hAlign/vAlign, 6 кнопок   │
# │     UI (3 H ⇤⇔⇥ + 3 V ⤒↕⤓), повторный клик на активном → сброс.  │
# │   • Konva TextSlot применяет finalHAlign / finalVAlign.           │
# │   • 12 новых тестов groups.test.ts; +обновление 4 старых (теперь  │
# │     parseAlbumTextStyleOverrides возвращает 4 поля вместо 2).     │
# │                                                                    │
# │ feat 358f40b (РЭ.54.b) — align в глобальной модалке:              │
# │   • AlbumTextStylesModal: те же 6 кнопок в каждой из 4 групп.     │
# │   • updateGroup принимает halign/valign, сохраняет в state.       │
# │   • Условие удаления группы: все 4 поля null (раньше 2).          │
# │                                                                    │
# │ feat c02ab56 (РЭ.54.c) — табы в PhotoPalette:                     │
# │   • PaletteTab type ('all'|'portrait'|'group'|'teacher'|'originals')│
# │   • State showOriginals ЗАМЕНЁН на activeTab. Checkbox убран.     │
# │   • Счётчики по ПОЛНОМУ пулу (не filtered) — стабильные при поиске│
# │   • activeTab='all' → секции одна под другой (старый layout).     │
# │     Конкретный таб → единая сетка без заголовка.                  │
# │                                                                    │
# │ fix bae2d7f (РЭ.54.d) — клик на странице переключает её активной: │
# │   Сергей: 'если выделена левая, кликаю на правой — окно           │
# │   открывается на левой; надо сначала кликнуть пустое место.'      │
# │   • DropZone передаёт instanceKey в onClick callback (был только  │
# │     в Props, не использовался).                                   │
# │   • TextDropZone caller (AlbumSpreadCanvas) передаёт              │
# │     instance.spread_index в onTextClick.                          │
# │   • handleTextClick / handlePhotoClick принимают instanceKey,     │
# │     setCurrentIdx(instanceKey) ПЕРЕД открытием панели если        │
# │     instanceKey !== currentIdx. spreadIndex panel'а = instanceKey.│
# │                                                                    │
# │ feat 6d4741e (РЭ.54.e) — все 8 категорий фото в палитре:          │
# │   Сергей: 'категории палитры не соответствуют категориям загрузки.│
# │   В разделе Фото есть портреты, групповые, учителя, общий разворот│
# │   класс, полкласса, 1/4, 1/6.'                                    │
# │   КОРЕНЬ: AlbumPhoto.type на фронте был 'portrait'|'group'|       │
# │   'teacher'|null, а API уже отдавал 8 значений (+5 common_*).     │
# │   • Расширены типы в PhotoPalette + page.tsx (синхрон).           │
# │   • PaletteTab расширен на 5 common_* (TAB_LABELS:                │
# │     common_spread→'На разворот', _full→'Класс', _half→'Полкласса',│
# │     _quarter→'1/4', _sixth→'1/6').                                │
# │   • visibleTabs показывает только табы с count > 0.               │
# │   • activeTab='all' рендерит все 9 секций (Section возвращает null│
# │     если массив пуст).                                            │
# │                                                                    │
# │ fix 767da10 (РЭ.54.f) — vertical-align работает в режиме редакт.: │
# │   Сергей: 'кнопки valign не сдвигают текст хоть фрейм большой'.   │
# │   КОРЕНЬ: vAlign применялся к Konva TextSlot, но при клике        │
# │   открывается textarea (TextInlineEditor) которая СКРЫВАЕТ Konva  │
# │   TextSlot. <textarea> HTML не поддерживает vertical-align.       │
# │   • TextInlineEditor: textarea теперь обёрнут в <div display:flex>│
# │     с alignItems по finalVAlign.                                  │
# │   • useEffect auto-resize textarea по scrollHeight (чтобы          │
# │     textarea не растягивалась на весь frame — это сломало бы      │
# │     visual valign).                                               │
# │   • Рамка '2px solid blue' перенесена с textarea на wrapper.      │
# │                                                                    │
# │ ═══════ КОММИТЫ ЗА V175 (14 шт) ═══════                            │
# │                                                                    │
# │   ddca5d0 — fix РЭ.52: попапы в правый сайдбар (откачено далее)   │
# │   a7d5d14 — fix РЭ.52.b: smart-position по точке клика           │
# │   c80c8e0 — fix РЭ.52.c: позиционирование по границам placeholder │
# │   20bfd3e — feat РЭ.53.a: БД + типы + API глобальных стилей      │
# │   b4f741a — feat РЭ.53.b: применение в canvas                    │
# │   6d115b4 — feat РЭ.53.c: UI модалка                              │
# │   e751b95 — feat РЭ.53.d: компактная + минус 2 группы            │
# │   9480249 — feat РЭ.54.a: точечное H+V выравнивание              │
# │   358f40b — feat РЭ.54.b: выравнивание в глобальной модалке      │
# │   c02ab56 — feat РЭ.54.c: табы по категориям в палитре           │
# │   bae2d7f — fix РЭ.54.d: клик переключает страницу разворота     │
# │   6d4741e — feat РЭ.54.e: все 8 категорий фото в палитре         │
# │   767da10 — fix РЭ.54.f: valign в режиме редактирования          │
# │   (этот)  — docs: context v175                                    │
# │                                                                    │
# │ ═══════ ОЧЕРЕДЬ НА БУДУЩЕЕ ═══════                                 │
# │                                                                    │
# │ Закрыто в v175:                                                   │
# │   ✅ Попапы редактора (РЭ.52 серия)                                │
# │   ✅ Глобальные стили текста для 4 групп (РЭ.53 серия)             │
# │   ✅ Точечное H/V выравнивание (РЭ.54.a)                          │
# │   ✅ Выравнивание в модалке (РЭ.54.b)                              │
# │   ✅ Табы фото-палитры по 8 категориям (РЭ.54.c+.e)               │
# │   ✅ UX-фикс клика на странице разворота (РЭ.54.d)                │
# │   ✅ V-align в textarea через flex-wrapper (РЭ.54.f)              │
# │                                                                    │
# │ Остаётся:                                                          │
# │                                                                    │
# │ 1. ВЕРТИКАЛЬНАЯ НАДПИСЬ 'Классный руководитель' — баг импорта     │
# │    IDML. В макете Сергея надпись 'Классный руководитель' должна   │
# │    идти вертикально вдоль длинной стороны портрета (90°). При     │
# │    импорте rotation теряется — показывается горизонтально с       │
# │    переносами 'Клас/сный/руко/води/тель'. Нужно объяснение        │
# │    Сергея про IDML технику + диагностика парсера                  │
# │    (lib/idml-import) + canvas/PDF rotation rendering.             │
# │                                                                    │
# │ 2. PDF EXPORT глобальных стилей — pdf-pipeline пока НЕ            │
# │    использует каскад text_style_overrides. Если партнёр настроит  │
# │    стили в редакторе и экспортирует PDF — стили НЕ применятся.    │
# │    Нужно: в lib/pdf-export или где там обработка text-placeholder │
# │    добавить тот же resolveFontSizeMult/resolveColor/resolveHAlign │
# │    /resolveVAlign каскад с подтягиванием albums.text_style_overrides│
# │    из БД.                                                         │
# │                                                                    │
# │ 3. ВЫБОР ШРИФТОВ (РЭ.55+) — поле font_family в JSONB схеме        │
# │    зарезервировано. Архитектура: curated список из 6-10 шрифтов  │
# │    (Noto Serif, Roboto, Inter, PT Serif, Open Sans...) с веб-     │
# │    копиями для редактора и PDF-копиями для экспорта. UI: 5-я      │
# │    секция в TextStylePanel + 5-я строка в каждой группе модалки.  │
# │    parseAlbumTextStyleOverrides добавит чтение поля font_family.  │
# │                                                                    │
# │ 4. AI-помощник для партнёров — большой отдельный проект.          │
# │    Claude API + RAG на доке + state UI + deep linking.           │
# │                                                                    │
# │ 5. Названия мастеров — обсуждение с Сергеем для подписей в UI    │
# │    селекторах (показываем имена мастеров без placeholder'ов /     │
# │    page_role / slot_capacity).                                    │
# │                                                                    │
# │ 6. РЭ.37.3.d (soft helpers для Standard/Universal на soft) —      │
# │    по необходимости. Сергей не планирует в ближайшее время.       │
# │                                                                    │
# │ 7. РЭ.44.a — улучшенный warning для pages_underflow. Активная     │
# │    ссылка на редактор шаблона. Без auto-fill.                     │
# │                                                                    │
# │ 8. Замена common-фото через handleReplaceFullPhoto: cast в        │
# │    page.tsx обрезает common_* типы до 'portrait'|'group'|         │
# │    'teacher'|null с fallback 'portrait'. Edge case — partner      │
# │    меняющий common-фото через ContextMenu теряет правильный type. │
# │                                                                    │
# │ ═══════ МИГРАЦИИ ДЛЯ ПРИМЕНЕНИЯ К ПРОДУ ═══════                    │
# │                                                                    │
# │ В Supabase Studio (применить ОБЯЗАТЕЛЬНО до использования стилей):│
# │                                                                    │
# │   -- РЭ.46 (из v173): override симметризации на альбоме            │
# │   ALTER TABLE albums                                               │
# │     ADD COLUMN IF NOT EXISTS                                       │
# │       symmetrize_students_tail_override boolean DEFAULT NULL;     │
# │                                                                    │
# │   -- РЭ.50 (из v174): cleanup мёртвых presets                     │
# │   DELETE FROM presets WHERE id IN (                                │
# │     'custom-qgrz75n3', 'custom-l34kwu6p', 'custom-vrfxcuqi'        │
# │   );                                                               │
# │                                                                    │
# │   -- РЭ.53 (новое в v175): глобальные стили текстов               │
# │   ALTER TABLE albums                                               │
# │     ADD COLUMN IF NOT EXISTS                                       │
# │       text_style_overrides JSONB DEFAULT NULL;                    │
# │                                                                    │
# │ ═══════ СОСТОЯНИЕ ПРОЕКТА ═══════                                 │
# │                                                                    │
# │   • npx vitest run    → 746/746 passed, 0 failed                  │
# │   • npx tsc --noEmit  → пусто                                     │
# │   • npx next build    → зелёный                                   │
# │                                                                    │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО В V174 (26.05.2026 — РЭ.50/51 + гигиена)               │
# │                                                                    │
# │ 2 гигиенических коммита после серии UX-полировки v173.            │
# │                                                                    │
# │ ═══════ КОММИТЫ ═══════                                             │
# │                                                                    │
# │ feat 734ed42 (РЭ.50) — cleanup мёртвых presets                    │
# │   ПРОБЛЕМА: На ранних этапах (до РЭ.21/24) поле template_set_id   │
# │   не было обязательным. В БД остались 3 невалидных пресета:        │
# │     - custom-qgrz75n3 («Стандарт»)                                 │
# │     - custom-l34kwu6p («Мой Мини»)                                 │
# │     - custom-vrfxcuqi («Мой пресет для школ»)                      │
# │   Все tenant-owned, template_set_id=NULL. Не могут собирать        │
# │   альбомы (без template_set engine не найдёт мастеров), в          │
# │   редакторе показывались с пометкой «Доработай».                   │
# │                                                                    │
# │   ИЗМЕНЕНИЯ:                                                       │
# │                                                                    │
# │   1. SQL для удаления (миграция):                                  │
# │      migrations/2026-05-26-cleanup-dead-presets.sql                │
# │        DELETE FROM presets WHERE id IN (                           │
# │          'custom-qgrz75n3', 'custom-l34kwu6p',                     │
# │          'custom-vrfxcuqi'                                         │
# │        );                                                          │
# │      ⚠️ Применять вручную в Supabase Studio.                       │
# │                                                                    │
# │   2. Защитный фильтр в API:                                        │
# │      app/api/tenant/route.ts:                                      │
# │        - templates_list_my: добавлен                               │
# │          .not('template_set_id', 'is', null).                      │
# │        - templates_list_global: то же.                             │
# │      Если в будущем такие пресеты появятся снова — UI не покажет.  │
# │                                                                    │
# │   Регрессий: нет. Валидные пресеты (с template_set_id) не          │
# │   затронуты.                                                       │
# │                                                                    │
# │ test dfa4033 (РЭ.51) — 0 fails в тестах                            │
# │   Гигиена pre-existing 11 fails в test-suite. Эти тесты были       │
# │   унаследованы от РЭ.37/РЭ.40 этапов. Каждый коммит мы видели      │
# │   красное 'Tests: 11 failed' — шум мешал замечать новые регрессии. │
# │                                                                    │
# │   КОРНЕВАЯ ПРИЧИНА УСТАРЕВАНИЯ:                                    │
# │                                                                    │
# │   1. РЭ.40: buildGrid и buildGridSemantic больше не выбирают       │
# │      adaptive masters (L-2/L-3/N-4/N-6/N-9 etc). Все хвосты идут   │
# │      в baseMaster с null-padding. adaptiveTailNames в GridConfig   │
# │      оставлены для обратной совместимости но не используются       │
# │      (см. lib/rule-engine/sections/students.ts:1015-1023 комментарий)│
# │                                                                    │
# │   2. РЭ.31.3: пустые слоты теперь получают                         │
# │      __hidden__<label>='1' вместо bindings[label]=null. Canvas     │
# │      скрывает пустые placeholder'ы (раньше они показывались с      │
# │      пустотой).                                                    │
# │                                                                    │
# │   3. РЭ.40 + новая common_required: section без явного pages[]    │
# │      выдаёт warning 'common_required_empty' и строит 0 страниц     │
# │      (раньше auto-собирала по density).                            │
# │                                                                    │
# │   4. РЭ.40: симметризация хвоста (symmetrize_students_tail=true)  │
# │      применяется ТОЛЬКО в greedy режиме распределения. В auto/     │
# │      equalize хвост распределяется равномерно — симметризация      │
# │      не нужна и поэтому decideDistribution возвращает               │
# │      symmetrizable=false.                                          │
# │                                                                    │
# │   ИЗМЕНЕНИЯ В ТЕСТАХ (production-код не трогали):                  │
# │                                                                    │
# │   • sections-common-additional.test.ts (1 fail):                   │
# │     'Universal hard чётное → 3 required + 2 additional' переписан  │
# │     в 'Universal hard чётное → common_required пустой (warning)    │
# │     + 2 разворота additional'. Ожидает spreads.length=2 (только    │
# │     additional) и warning 'common_required_empty'.                 │
# │                                                                    │
# │   • sections-students.test.ts (6 fails):                           │
# │     makeInput добавлен 'student_distribution: greedy' — это явно   │
# │     включает legacy режим где хвост в base мастер с null-padding.  │
# │     Все 6 тестов переписаны: 'L-3/L-2/N-6/N-4' заменены на         │
# │     'L-Grid-Page/N-Grid-Page с __hidden__'. Удалены ожидания       │
# │     warning students_grid_tail_padded (deprecated в РЭ.40).        │
# │                                                                    │
# │   • sections-students-grid-semantic.test.ts (3 fails):             │
# │     makeInput добавлен 'student_distribution: greedy'. Без этого   │
# │     auto разбил бы 7 учеников на 4+3 вместо 6+1, и                 │
# │     ожидаемые portrait paths не совпадали бы. Тесты переписаны    │
# │     под РЭ.40 поведение: L-Grid с __hidden__ вместо L-2.           │
# │     Decision trace тест: rule_id формат изменился с                │
# │     'grid_semantic:base/adaptive_tail' на унифицированный          │
# │     'grid_semantic:${mode}:${pageIdx}'.                            │
# │                                                                    │
# │   • sections-transition-combo.test.ts (1 fail):                    │
# │     'Light 13 + symmetrize=true → combo с 2 учениками' получил     │
# │     явное 'student_distribution: greedy' в input. Без этого        │
# │     симметризация не активируется (decideDistribution возвращает   │
# │     symmetrizable=false в auto/equalize режимах).                  │
# │                                                                    │
# │   РЕЗУЛЬТАТ:                                                       │
# │     npx vitest run → 711/711 passed, 0 failed (было 700/711).      │
# │     Новые регрессии теперь видны сразу без шума pre-existing fails.│
# │                                                                    │
# │ ═══════ МИГРАЦИИ ДЛЯ ПРИМЕНЕНИЯ К ПРОДУ ═══════                    │
# │                                                                    │
# │ В Supabase Studio (если ещё не сделано):                           │
# │                                                                    │
# │   -- РЭ.46 (из v173): override симметризации на альбоме            │
# │   ALTER TABLE albums                                               │
# │     ADD COLUMN IF NOT EXISTS                                       │
# │       symmetrize_students_tail_override boolean DEFAULT NULL;      │
# │                                                                    │
# │   -- РЭ.50: cleanup мёртвых presets                                │
# │   DELETE FROM presets WHERE id IN (                                │
# │     'custom-qgrz75n3', 'custom-l34kwu6p', 'custom-vrfxcuqi'        │
# │   );                                                               │
# │                                                                    │
# │ ═══════ ОЧЕРЕДЬ НА БУДУЩЕЕ ═══════                                 │
# │                                                                    │
# │ Закрыто в v174:                                                   │
# │   ✅ Cleanup мёртвых presets через SQL                             │
# │   ✅ Pre-existing 11 fails в тестах                                │
# │                                                                    │
# │ Остаётся:                                                          │
# │                                                                    │
# │ 1. AI-помощник для партнёров — большой отдельный проект.           │
# │    Архитектура: Claude API + RAG на доке + state UI +              │
# │    deep linking. Обсудить когда продукт стабилизируется.            │
# │                                                                    │
# │ 2. Названия мастеров — обсуждение с Сергеем для подписей в UI      │
# │    селекторах (сейчас показываем только имена без placeholder'ов / │
# │    page_role / slot_capacity).                                     │
# │                                                                    │
# │ 3. РЭ.37.3.d (soft helpers для Standard/Universal на soft) —       │
# │    по необходимости. Сергей не планирует soft Standard/Universal   │
# │    в ближайшее время.                                              │
# │                                                                    │
# │ 4. РЭ.44.a — улучшенный warning для pages_underflow.               │
# │    Если позже понадобится: текст с подсказкой типа 'Альбом на 10   │
# │    стр., минимум 12. Добавьте ещё 1 разворот в общий раздел.'      │
# │    Активная кнопка/ссылка на редактор шаблона. Без auto-fill.      │
# │                                                                    │
# │ ═══════ КОММИТЫ ЗА V174 (3 шт) ═══════                             │
# │                                                                    │
# │   734ed42 — feat РЭ.50: cleanup мёртвых presets                    │
# │   dfa4033 — test РЭ.51: 0 fails в тестах                           │
# │   (этот)  — docs: context v174                                     │
# │                                                                    │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО В V173 (26.05.2026 — РЭ.45/46/47/48/49 + фикс)         │
# │                                                                    │
# │ 7 коммитов UX-полировки по обратной связи Сергея после визуального │
# │ тестирования РЭ.42 + РЭ.43 на Тест25 (Light soft, 25 учеников).   │
# │                                                                    │
# │ ═══════ КОММИТЫ ═══════                                             │
# │                                                                    │
# │ feat e887a47 (РЭ.45) — DnD для секций в PresetEditorModal          │
# │   По запросу Сергея из идей v171→v172: в редакторе шаблона порядок │
# │   секций section_structure меняется не только стрелками ▲▼, но и   │
# │   drag-and-drop. Согласовано с уже реализованным DnD для страниц   │
# │   общего раздела (CommonRequiredPagesEditor).                      │
# │                                                                    │
# │   Реализация: @dnd-kit/core + sortable (уже в проекте).            │
# │   ID секции = `section-${idx}-${type}` (синтетический).            │
# │   Drag-handle ⋮⋮ слева от карточки (отдельная зона чтобы не        │
# │   конфликтовать со стрелками и кнопкой ×). Стрелки сохранены       │
# │   для клавиатуры. Активация drag через 5px смещения. Visual:       │
# │   opacity:0.5 + z-index:10 при перетаскивании.                     │
# │                                                                    │
# │   Файл: app/super/presets/_components/PresetEditorModal.tsx        │
# │   - Импорты DndContext/SortableContext/useSortable/arrayMove.      │
# │   - reorderSections(oldIdx, newIdx) в основном компоненте.         │
# │   - SectionsEditor обёрнут в DndContext+SortableContext.           │
# │   - Каждый item → отдельный компонент SortableSectionItem          │
# │     (выделен потому что хук useSortable требует компонента).       │
# │                                                                    │
# │ fix 7b05734 (РЭ.43.B.3) — форзацы в превью не пропадают            │
# │                            при повторном открытии заказа           │
# │   ПРОБЛЕМА: после РЭ.43.B превью корректно показывало форзацы для  │
# │   soft binding, но только сразу после пересборки. При закрытии     │
# │   заказа и повторном открытии форзацы исчезали — превью работало  │
# │   как для layflat.                                                 │
# │                                                                    │
# │   КОРЕНЬ: РЭ.43.B пробрасывал sheet_type через layout.summary, но  │
# │   сохранённый в БД layout (legacy до РЭ.43.B) не имел этого поля.  │
# │   Свежие пересборки клали поле, старые — нет.                      │
# │                                                                    │
# │   ФИКС: fallback на album.print_type через новый проп albumPrintType│
# │   у LayoutPreviewStrip. Приоритет: layout.summary.sheet_type (свежие│
# │   layout'ы) > album.print_type (legacy). Без миграции БД.          │
# │                                                                    │
# │   Файлы:                                                           │
# │   - app/app/_components/LayoutPreviewStrip.tsx (новый проп +        │
# │     fallback в sheetType).                                         │
# │   - app/app/page.tsx (передаёт album.print_type в LayoutPreviewStrip)│
# │                                                                    │
# │ feat 8a998cd (РЭ.46) — симметризация хвоста перенесена с пресета   │
# │                          на альбом (inline-контрол на Обзоре)      │
# │   По запросу Сергея — симметризация часто-меняемая настройка,      │
# │   удобнее переключать для конкретного альбома без редактирования   │
# │   шаблона. По аналогии с РЭ.41.a/b/c.                              │
# │                                                                    │
# │   БД миграция: migrations/2026-05-26-albums-symmetrize-override.sql│
# │     ALTER TABLE albums ADD COLUMN                                  │
# │       symmetrize_students_tail_override boolean DEFAULT NULL;      │
# │     NULL = используем значение из пресета.                         │
# │                                                                    │
# │   API:                                                             │
# │   - app/api/tenant/route.ts: валидация (boolean|null) + добавлено  │
# │     поле в allowedFields update_album.                             │
# │   - app/api/layout/route.ts: SELECT extended на новое поле, при    │
# │     override true/false переопределяем bundle.preset                │
# │     .symmetrize_students_tail перед сборкой.                       │
# │                                                                    │
# │   UI:                                                              │
# │   - app/app/page.tsx: Album type расширен, новый компонент         │
# │     SymmetrizeTailControl с tri-state select (потом в РЭ.49        │
# │     заменён на чекбокс — см. ниже).                                │
# │                                                                    │
# │ feat 36e4c42 (РЭ.47) — компактные карточки шаблонов               │
# │   По запросу Сергея — карточки на /app/templates и в               │
# │   TemplatePickerModal были слишком большими (1-3 колонки, 160px    │
# │   превью + 3 mini-превью + крупные кнопки).                        │
# │                                                                    │
# │   Изменения:                                                       │
# │   - app/app/templates/[designId]/page.tsx: грид 1/2/3 → 2/3/4/5/6  │
# │     колонок. p-4 → p-3, gap-4 → gap-3. Удалена полоса 3            │
# │     mini-превью (cover/teachers/soft) — отвлекала. Бейджи          │
# │     уменьшены (text-xs → text-[10px]). Удалена функция MiniPreview │
# │     (unused). Кнопки py-1.5 px-3 text-sm → py-1 px-2 text-xs.      │
# │   - app/app/page.tsx: грид в TemplatePickerModal 1/2/3 → 2/3/4/5,  │
# │     gap-3 → gap-2.                                                 │
# │                                                                    │
# │ feat 9dd50a4 (РЭ.48) — двухуровневый выбор в TemplatePickerModal  │
# │   По запросу Сергея — раньше при «Выбрать шаблон» открывался        │
# │   плоский список всех шаблонов всех дизайнов. С появлением         │
# │   нескольких дизайнов это неудобно: партнёр должен сначала         │
# │   определиться с дизайном (стиль/обложка), а потом выбирать         │
# │   шаблон в нём (комплектация).                                     │
# │                                                                    │
# │   Согласовано с UX /app/templates (там уже двухуровневое):         │
# │   /app/templates → дизайны, /app/templates/<id> → шаблоны.         │
# │                                                                    │
# │   Реализация (всё в TemplatePickerModal в app/app/page.tsx):       │
# │   - state step: 'design' | 'templates'                             │
# │   - useEffect после загрузки: 1 дизайн → сразу 'templates';        │
# │     currentPresetId задан → 'templates' с дизайном выбранного;     │
# │     иначе 'design' (фреш-выбор).                                   │
# │   - Шаг 1: грид карточек дизайнов с превью (из первого доступного  │
# │     шаблона) + счётчик 'N шаблонов' с правильным склонением.       │
# │   - Шаг 2: тот же грид Мои/Готовые, но без внутренней группировки  │
# │     по дизайнам (один дизайн уже выбран).                          │
# │   - Кнопка '← К дизайнам' слева от заголовка на шаге 2.            │
# │   - Старый select-фильтр в шапке удалён.                           │
# │   - Удалён Map globalsByDesign + группировка-разделители.          │
# │                                                                    │
# │ feat 24ca2b0 (РЭ.49) — крошка 'Главная' + чекбокс симметризации    │
# │   Две правки:                                                      │
# │                                                                    │
# │   А. Крошки 'Главная' на страницах шаблонов:                      │
# │   - /app/templates: 'Главная / Шаблоны'                            │
# │   - /app/templates/<id>: 'Главная / Шаблоны / <дизайн>'           │
# │     (раньше было только 'Шаблоны / Дизайн').                       │
# │                                                                    │
# │   Б. SymmetrizeTailControl: tri-state SELECT → ПРОСТОЙ ЧЕКБОКС:    │
# │   Сергей: 'Если убрали из шаблона, как тогда работает «По шаблону»?│
# │   Лучше простой чекбокс.'                                          │
# │   - UI: select → checkbox 'Симметризировать хвост' с описанием    │
# │     под ним (по паттерну IncludeNonPurchasersControl).             │
# │   - БД-схема осталась boolean|null (legacy совместимость).         │
# │   - В UI: null → checkbox снят, true → стоит, false → снят.        │
# │   - Engine логика не изменена (true/false применяется как override).│
# │                                                                    │
# │ feat 6ae249b (РЭ.49.b) — убрать чекбокс симметризации из шаблона  │
# │   После переноса настройки на альбом (РЭ.46) — чекбокс в           │
# │   PresetEditorModal стал дубликатом и путал партнёров.             │
# │                                                                    │
# │   Изменения:                                                       │
# │   - app/super/presets/_components/PresetEditorModal.tsx:           │
# │     удалён UI-блок чекбокса, useState и передача поля в payload.   │
# │   - БД-поле presets.symmetrize_students_tail НЕ удалено — engine   │
# │     продолжает читать его как fallback (когда альбомный override   │
# │     null). PATCH без поля не затирает существующее значение.       │
# │   - TypeScript-тип Preset тоже сохранён.                           │
# │   - Сергей предупредил «может потом придётся вернуть» — поэтому    │
# │     рекавер из git history будет тривиальным.                      │
# │                                                                    │
# │ ═══════ ПРОВЕРКИ КАЖДОГО КОММИТА ═══════                           │
# │                                                                    │
# │   • npx tsc --noEmit → пусто                                       │
# │   • npx next build → зелёный                                       │
# │   • полный suite: 11 fails — все pre-existing baseline             │
# │                                                                    │
# │ ═══════ МИГРАЦИИ ДЛЯ ПРИМЕНЕНИЯ К ПРОДУ ═══════                    │
# │                                                                    │
# │ Перед деплоем РЭ.46 (8a998cd) в Supabase Studio выполнить:         │
# │   ALTER TABLE albums                                               │
# │     ADD COLUMN IF NOT EXISTS                                       │
# │       symmetrize_students_tail_override boolean DEFAULT NULL;      │
# │                                                                    │
# │ Без миграции PATCH update_album с этим полем упадёт.               │
# │                                                                    │
# │ ═══════ ОЖИДАНИЯ ОТ СЕРГЕЯ ПОСЛЕ ДЕПЛОЯ ═══════                    │
# │                                                                    │
# │ После РЭ.45-49 партнёр в /app:                                     │
# │   1. Превью на «Обзоре» показывает форзацы и при повторном         │
# │      открытии заказа (РЭ.43.B.3 fallback).                         │
# │   2. На «Обзоре» под «Включить в личный раздел всех учеников»      │
# │      появился чекбокс «Симметризировать хвост» с описанием.        │
# │   3. На страницах шаблонов хлебные крошки начинаются с «Главная».  │
# │   4. Карточки шаблонов компактнее в 2-3 раза (5-6 в ряд).          │
# │   5. «Выбрать шаблон» → сначала выбор дизайна, потом шаблоны.      │
# │   6. В редакторе шаблона секции можно перетаскивать за ⋮⋮.         │
# │   7. В редакторе шаблона больше нет дублирующей галки              │
# │      «Симметризировать хвост» (управление на альбоме).             │
# │                                                                    │
# │ ═══════ ОБСУЖДЕНО В СЕССИИ — ОТЛОЖЕНО ═══════                      │
# │                                                                    │
# │ • РЭ.44 (auto-fill до min_pages) — рассмотрено, решили НЕ делать.  │
# │   Текущий warning «10 < min_pages 12» достаточен. Auto-fill        │
# │   нарушил бы доверие к движку (engine кладёт ровно то что в        │
# │   section_structure). Если позже партнёры начнут ругаться —        │
# │   сделаем РЭ.44.a (улучшенный текст warning с кнопкой-ссылкой).    │
# │                                                                    │
# │ • РЭ.41.d (выбор шаблона на Обзоре) — отложено по решению          │
# │   Сергея. Шаблон редко меняется, текущий workflow «Сменить шаблон» │
# │   из настроек работает.                                            │
# │                                                                    │
# │ • РЭ.37.3.d (soft helpers для Standard/Universal на soft) —        │
# │   по необходимости. Сергей не планирует soft Standard/Universal    │
# │   в ближайшее время.                                               │
# │                                                                    │
# │ ═══════ ИЗ ОЧЕРЕДИ НА БУДУЩЕЕ ═══════                              │
# │                                                                    │
# │ 1. AI-помощник для партнёров — большой отдельный проект.           │
# │    Архитектура: Claude API + RAG на доке + state UI + deep linking.│
# │    Обсудить когда продукт стабилизируется.                          │
# │                                                                    │
# │ 2. Cleanup pre-existing 11 fails в тестах:                         │
# │    sections-students.test.ts (6), sections-students-grid-semantic   │
# │    (3), sections-common-additional (1), sections-transition-combo  │
# │    (1). Унаследовано с РЭ.37/40. Не блокирует, гигиена ~2-3 часа.  │
# │    Польза: видим новые регрессии без шума от старых fails.         │
# │                                                                    │
# │ 3. Названия мастеров — обсуждение с Сергеем для подписей в UI      │
# │    селекторах (сейчас показываем только имена без placeholder'ов / │
# │    page_role / slot_capacity).                                     │
# │                                                                    │
# │ 4. Cleanup мёртвых presets через SQL:                              │
# │    DELETE FROM presets WHERE id IN (                               │
# │      'custom-qgrz75n3', 'custom-l34kwu6p', 'custom-vrfxcuqi'       │
# │    );                                                              │
# │    Эти 3 пресета не имеют template_set_id (создавались на ранних   │
# │    этапах когда поле не было обязательным). После РЭ.48            │
# │    (двухуровневый выбор) они не видны в UI, но в TemplatePickerModal│
# │    могут возвращаться API. Параллельно: добавить фильтр на бэке    │
# │    скрывающий presets с template_set_id IS NULL.                   │
# │                                                                    │
# │ 5. РЭ.44.a — улучшенный warning для pages_underflow.               │
# │    Если позже понадобится: текст с подсказкой типа 'Альбом на 10   │
# │    стр., минимум 12. Добавьте ещё 1 разворот в общий раздел.'      │
# │    Активная кнопка/ссылка на редактор шаблона. Без auto-fill.      │
# │                                                                    │
# │ ═══════ КОММИТЫ ЗА V173 (8 шт) ═══════                             │
# │                                                                    │
# │   e887a47 — feat РЭ.45: DnD для секций                             │
# │   7b05734 — fix РЭ.43.B.3: форзацы при повторном открытии заказа  │
# │   8a998cd — feat РЭ.46: симметризация хвоста на уровне альбома    │
# │   36e4c42 — feat РЭ.47: компактные карточки шаблонов               │
# │   9dd50a4 — feat РЭ.48: двухуровневый выбор шаблона                │
# │   24ca2b0 — feat РЭ.49: крошка 'Главная' + чекбокс симметризации   │
# │   6ae249b — feat РЭ.49.b: убрать чекбокс симметризации из шаблона  │
# │   (этот)  — docs: context v173                                     │
# │                                                                    │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО В V172 (25.05.2026, поздний вечер — РЭ.43 + РЭ.43.B)    │
# │                                                                    │
# │ Две связанные правки по результатам визуального тестирования       │
# │ РЭ.42 на эталоне Тест2 (Mini soft, 30 учеников):                  │
# │                                                                    │
# │ 1. РЭ.43: soft_intro и soft_final защищены от max_pages обрезки.   │
# │ 2. РЭ.43.B: превью на «Обзоре» корректно показывает форзацы для    │
# │    soft binding (фикс баг детекции по имени мастера 'S-Intro').    │
# │                                                                    │
# │ ═══════ КОММИТЫ ФАЗЫ РЭ.43 (2 шт) ═══════                          │
# │                                                                    │
# │ feat 4add227 (РЭ.43) — защита от max_pages обрезки                 │
# │   КОНТЕКСТ:                                                        │
# │     Сергей тестировал Тест2 на soft с РЭ.42 (F-Head-SmallGrid      │
# │     через soft_intro override). Структура: intro + 3 students      │
# │     (auto 10+10+10) + 2 common_required + soft_final = 7 страниц.  │
# │     max_pages=6 → engine тупо обрезал последнюю → soft_final       │
# │     потерян. Это ломает физику soft binding: финальная страница    │
# │     обязана быть на форзаце.                                       │
# │                                                                    │
# │   РЕШЕНИЕ — захардкоженный whitelist PROTECTED_SECTION_TYPES =     │
# │   {soft_intro, soft_final}. При обрезке движок ищет не-защищённые  │
# │   страницы (common_required → students) и режет их с конца.        │
# │   Защищённые остаются. Edge-case 'защищённых больше чем влезает    │
# │   в max_pages' → warning pages_overflow_partial_truncation         │
# │   с инструкцией.                                                   │
# │                                                                    │
# │   Изменения:                                                       │
# │     • lib/rule-engine/types.ts — PageInstance.section_type?:       │
# │       SectionStructureEntry['type']. Аддитивно, NULL допустим.     │
# │     • lib/rule-engine/build-from-section-structure.ts:             │
# │       - Тегирование: после каждой fill-функции проставляется       │
# │         section_type для добавленных страниц.                      │
# │       - Truncation logic переписана: removableIndices = всё кроме  │
# │         PROTECTED, удаляются последние toRemove через filter.      │
# │       - Warning формат обновлён: 'pages_overflow_truncated: ...    │
# │         (soft_intro/soft_final защищены, обрезаются страницы       │
# │         общего раздела/students)'.                                 │
# │     • lib/rule-engine/__tests__/max-pages-protection.test.ts —     │
# │       6 тестов: тегирование, не-превышение, защита soft_final при  │
# │       превышении, агрессивная обрезка с защитой обоих, partial для │
# │       max_pages меньше числа защищённых, layflat без защиты.       │
# │                                                                    │
# │   Сценарий для Тест2 после фикса:                                  │
# │     intro + 3 students + 2 common + final = 7, max_pages=6         │
# │     → обрезается последняя common (J-Collage-6, она ПОСЛЕДНЯЯ      │
# │       из removable)                                                │
# │     → итог: intro + 3 students + J-Half + final = 6                │
# │     → форзацы на физических 1 и последней — soft binding жив.      │
# │                                                                    │
# │ feat 9da0d8d (РЭ.43.B) — фикс превью на Обзоре для soft            │
# │   КОНТЕКСТ:                                                        │
# │     После РЭ.42 Сергей положил F-Head-SmallGrid в soft_intro       │
# │     override. На «Обзоре» превью разворотов показало это как       │
# │     [F-Head-SmallGrid, students[0]] — БЕЗ форзаца. В Редакторе     │
# │     было правильно: [форзац, F-Head-SmallGrid]. Расхождение Обзор  │
# │     vs Редактор — известная семейная боль (РЭ.37.3.c исправил это  │
# │     для S-Intro по имени, но для override это не сработало).       │
# │                                                                    │
# │   КОРЕНЬ:                                                          │
# │     В LayoutPreviewStrip.groupIntoVisualSpreads была захардкоженная│
# │     проверка `tmpl.name === 'S-Intro'`. Если матч — спецслучай     │
# │     (right-only). После РЭ.42 партнёр может выбрать ЛЮБОЙ мастер   │
# │     вместо S-Intro — проверка по имени перестала работать.         │
# │                                                                    │
# │   ФИКС:                                                            │
# │     Переход с детекции по имени на детекцию по sheet_type          │
# │     (симметрично engine'у).                                        │
# │                                                                    │
# │   Изменения:                                                       │
# │     • app/api/layout/route.ts — в summary секции                   │
# │       section_structure-движка добавлен sheet_type. Значение       │
# │       после resolvePrintType (override альбомного print_type над   │
# │       пресетом).                                                   │
# │     • app/app/page.tsx — SmartFillSummary type расширен на         │
# │       sheet_type?: 'hard' | 'soft' | null.                         │
# │     • app/app/_components/LayoutPreviewStrip.tsx:                  │
# │       - LayoutShape.summary.sheet_type принимается.                │
# │       - groupIntoVisualSpreads принимает третий параметр sheetType.│
# │       - Удалена детекция 'tmpl.name === \"S-Intro\"' — устарела.   │
# │       - Новая логика: isSoft && idx=0 && !section_start →          │
# │         {left:null, right:s}. Симметрично engine.                  │
# │     • lib/rule-engine/__tests__/max-pages-protection.test.ts:      │
# │       фикстура students перешла на правильные поля                 │
# │       RulesStudentInput.full_name / portrait.                      │
# │                                                                    │
# │   Регрессии: для non-soft альбомов поведение прежнее (sheetType=   │
# │   'hard'|null → парная группировка с idx=0).                       │
# │                                                                    │
# │ ═══════ ПРОВЕРКИ ═══════                                            │
# │   • npx tsc --noEmit — пусто                                       │
# │   • npx next build — зелёный                                       │
# │   • max-pages-protection.test.ts: 6/6 passed                       │
# │   • полный suite: 11 fails — все pre-existing, baseline тот же     │
# │                                                                    │
# │ ═══════ ОЖИДАНИЯ ОТ СЕРГЕЯ ПОСЛЕ ДЕПЛОЯ ═══════                    │
# │   На том же Тест2 (Mini soft, 30 учеников, soft_intro override     │
# │   F-Head-SmallGrid, max_pages=6):                                  │
# │     - «Пересобрать» → soft_final НЕ обрезается; обрезается одна    │
# │       страница общего раздела (J-Collage-6, последняя из removable)│
# │     - Превью на «Обзоре» → первый разворот = [форзац, F-Head],     │
# │       последний = [soft_final, форзац] (симметрично Редактору)     │
# │     - Warning теперь упоминает защиту: «soft_intro/soft_final      │
# │       защищены, обрезаются страницы общего раздела/students»       │
# │                                                                    │
# │ ═══════ ИЗ ОЧЕРЕДИ — ЧТО ДАЛЬШЕ ═══════                            │
# │                                                                    │
# │ 1. Тест Сергея на Тест2 после деплоя — приёмка РЭ.42 + РЭ.43 +     │
# │    РЭ.43.B вместе. Это завершает фазу «soft binding ручной выбор   │
# │    мастера + защита».                                              │
# │                                                                    │
# │ 2. Идеи в очереди (см. v171):                                      │
# │    - UX: drag-and-drop для секций в PresetEditorModal              │
# │    - AI-помощник для партнёров и сотрудников                       │
# │    - РЭ.41.d — выбор шаблона (section_structure_preset_id) на      │
# │      'Обзоре' альбома                                              │
# │    - РЭ.37.3.d — soft-чётность helpers для students.ts /           │
# │      common-required.ts                                            │
# │    - Pre-existing 11 fails в тестах — cleanup baseline             │
# │    - Названия мастеров — обсуждение для подписей в UI селекторах   │
# │    - cleanup мёртвых presets (custom-qgrz75n3, custom-l34kwu6p,    │
# │      custom-vrfxcuqi) через SQL                                    │
# │                                                                    │
# │ ═══════ КОММИТЫ ЗА V172 (3 шт) ═══════                             │
# │                                                                    │
# │   4add227 — feat РЭ.43: защита soft_intro/soft_final от max_pages  │
# │   9da0d8d — feat РЭ.43.B: фикс превью на Обзоре для soft binding   │
# │   (этот)  — docs: context v172                                     │
# │                                                                    │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО В V171 (25.05.2026, поздний вечер — РЭ.42)              │
# │                                                                    │
# │ ФИЧА: партнёр может вручную выбрать мастер для soft_intro и        │
# │ soft_final секций (вместо автоматического classphoto). Это нужно   │
# │ когда на первой правой странице soft-альбома хочется учителей /    │
# │ классного руководителя / воспитателей детсада / любой кастомный    │
# │ мастер из template_set.                                            │
# │                                                                    │
# │ КОНТЕКСТ: ранее soft_intro жёстко искал мастер с page_role='intro' │
# │ + photos_full=1 (общее фото класса). soft_final аналогично. У      │
# │ Сергея кейс — Mini soft, 30 учеников, 6 страниц: нужна 1 страница  │
# │ intro с УЧИТЕЛЯМИ (не классфото) + 3 страницы students + soft_final│
# │ . Полноценный teachers-разворот ему был не нужен (он бы дал 2      │
# │ страницы вместо 1), а через workaround (common_required в начало)  │
# │ нельзя — common_required синглтон-секция и она уже занята в схеме. │
# │                                                                    │
# │ ═══════ КОММИТЫ ФАЗЫ РЭ.42 (4 шт) ═══════                          │
# │                                                                    │
# │ feat 515d6a8 (РЭ.42.a) — типы                                       │
# │   • lib/rule-engine/types.ts: SectionStructureEntry расщеплён,      │
# │     soft_intro и soft_final выделены в отдельные ветки с           │
# │     master_name?: string | null. teachers/students/vignette        │
# │     остались простыми { type } без полей.                          │
# │   • app/api/tenant/route.ts: ValidatedSection + цикл валидации     │
# │     добавлен case для soft_intro/soft_final с проверкой            │
# │     master_name (string ≤200 или null). Комментарий формы          │
# │     синхронизирован.                                               │
# │   • Миграция БД не нужна — section_structure JSONB, старые записи  │
# │     без master_name остаются валидными.                            │
# │                                                                    │
# │ feat d478e34 (РЭ.42.b) — engine                                    │
# │   • lib/rule-engine/sections/soft-intro.ts и soft-final.ts:        │
# │     если section.master_name задан → ищем мастер по точному имени │
# │     в mastersByName. Если не найден → warning                      │
# │     'soft_{intro,final}_master_override_not_found' и SKIP страницы │
# │     (намеренно: не падаем на автоматический classphoto, чтобы      │
# │     партнёр заметил опечатку / отсутствие мастера в template_set). │
# │     Если master_name пустой/null → старая логика (семантика +      │
# │     legacy fallback).                                              │
# │     В decision_trace добавлено inputs.overridden: boolean.         │
# │   • build-from-section-structure.ts: case 'soft_intro' /           │
# │     'soft_final' передают section entry в fill-функцию             │
# │     (по аналогии с transition).                                    │
# │   • Новый тест-файл sections-soft-master-override.test.ts — 8      │
# │     тестов (4 intro + 4 final): валидный override, override с      │
# │     несуществующим именем, без override (regression), override +   │
# │     hard (skipped).                                                │
# │                                                                    │
# │ feat 2e284ae (РЭ.42.b.2) — автобиндинг teacher-placeholder         │
# │   По запросу Сергея: «хочу чтобы teacher-фото подтягивались        │
# │   автоматически».                                                  │
# │   • lib/rule-engine/sections/shared.ts: новая функция              │
# │     bindOverrideMasterPlaceholders(master, input, available).      │
# │     Placeholder-driven обход всех placeholder'ов мастера.          │
# │     Поддерживаемые labels: classphotoframe, halfphoto_N,           │
# │     headteacherphoto/name/role/text/quote/textframe,               │
# │     subjectphoto_N / subject_N / teacherphoto_N,                   │
# │     subjectname_N / teachername_N, subjectrole_N / teacherrole_N.  │
# │     Отсутствующие subjects / фото → __hidden__<label>='1'.         │
# │     Возвращает {bindings, consumes: {full_class, half_class}}.     │
# │   • soft-intro/soft-final: в override-режиме вызывают эту функцию. │
# │     В автоматическом режиме (без override) — старая classphoto-only│
# │     логика сохранена (минимизация риска регрессий для S-Intro /    │
# │     S-Final-Soft-L мастеров).                                      │
# │   • +5 новых тестов: автобиндинг headteacher+subjects, __hidden__  │
# │     для лишних subjects, classphoto+headteacher вместе, симметрия  │
# │     intro/final, regression автоматического режима.                │
# │   • decision_trace.inputs.consumes расширен на half_class.         │
# │     Старые 2 теста соответственно обновлены.                       │
# │                                                                    │
# │ feat 3ae448a (РЭ.42.c) — UI                                        │
# │   • app/super/presets/_components/PresetEditorModal.tsx:           │
# │     - Локальный Section type расщеплён аналогично types.ts.        │
# │     - В рендере SectionsEditor у секций soft_intro/soft_final      │
# │       показывается блок с SoftSectionMasterPicker — паттерн как у  │
# │       TransitionMasterSelector (проверки hasTemplateSet /          │
# │       templatesLoading).                                           │
# │     - Новый компонент SoftSectionMasterPicker — select с опцией    │
# │       'По умолчанию (общее фото класса)' + перечень всех мастеров  │
# │       template_set (без -Right вариантов, sort по имени).          │
# │       Подсказка под селектом объясняет смысл выбора.               │
# │   • UX-замечание: в подписях показывается только имя мастера, без  │
# │     placeholder'ов / page_role / slot_capacity. Названия мастеров  │
# │     Сергей хочет обсудить отдельно.                                │
# │                                                                    │
# │ ═══════ ПРОВЕРКИ ═══════                                            │
# │                                                                    │
# │ Каждый из 4 коммитов прошёл:                                       │
# │   • npx tsc --noEmit → пусто                                       │
# │   • npx next build → зелёный                                       │
# │   • npx vitest run (новый файл): 13/13 passed                      │
# │   • полный suite: 689/700 (11 fails — все pre-existing, не из      │
# │     моих файлов; baseline 17, мои 13 добавились зелёными)          │
# │                                                                    │
# │ ═══════ ПОЛЬЗОВАТЕЛЬСКИЙ СЦЕНАРИЙ ═══════                          │
# │                                                                    │
# │ Партнёр в PresetEditorModal:                                       │
# │   1. Создаёт/редактирует Mini soft шаблон                          │
# │   2. В section_structure: soft_intro → teachers → students →       │
# │      common_required → soft_final                                  │
# │   3. (новое) У soft_intro в селекторе мастера выбирает             │
# │      'J-Teachers-Single' (или другой нужный) вместо 'По умолчанию' │
# │   4. Сохраняет шаблон                                              │
# │                                                                    │
# │ Партнёр в карточке альбома:                                        │
# │   5. Выбирает этот шаблон                                          │
# │   6. Жмёт 'Пересобрать'                                            │
# │                                                                    │
# │ Engine собирает:                                                   │
# │   - На R 1-го разворота soft — мастер J-Teachers-Single            │
# │   - headteacherphoto/name/role/text → headTeacher автоматически    │
# │   - teacherphoto_N/teachername_N → subjects[N-1] автоматически     │
# │   - Лишние subject-слоты (если subjects короче чем мастер ожидает) │
# │     скрыты через __hidden__                                        │
# │   - В decision_trace inputs.overridden=true, semantic=false        │
# │                                                                    │
# │ ═══════ ОГРАНИЧЕНИЯ MVP (известные) ═══════                         │
# │                                                                    │
# │ • Биндинг pad master placeholder'ов студентов (studentportrait_N)  │
# │   в override-режиме НЕ поддержан — если партнёр положит            │
# │   ученическую страницу в intro/final, studentportrait_* останутся  │
# │   пустыми. Это не было запрошено и редкий случай.                  │
# │ • Если на одной странице мастер с halfphoto_1 + halfphoto_2 — оба  │
# │   биндятся (consumes.half_class=2). Дальнейшие секции учитывают    │
# │   через available.half_class -= 2.                                 │
# │                                                                    │
# │ ═══════ ОЧЕРЕДНАЯ ОЧЕРЁДНОСТЬ ═══════                              │
# │                                                                    │
# │ Сергей сейчас тестирует РЭ.42 на эталоне (клон Тест2 → переключить │
# │ soft_intro на учительский мастер → пересобрать). После приёмки —   │
# │ возвращаемся к основной задаче «тестирование soft binding» с       │
# │ нормальной структурой шаблона.                                     │
# │                                                                    │
# │ ═══════ ИДЕИ НА ПОТОМ (из обсуждения сегодня) ═══════              │
# │                                                                    │
# │ 1. UX: drag-and-drop для секций в PresetEditorModal.               │
# │    Сейчас порядок меняется стрелками ▲▼. По аналогии с уже         │
# │    сделанным DnD для страниц в common_required — сделать DnD и     │
# │    для секций. Не блокирующее, но удобнее.                         │
# │                                                                    │
# │ 2. AI-помощник для партнёров и сотрудников. Знает продукт, личный  │
# │    кабинет, даёт ссылки на нужные страницы. Замена менеджеру.      │
# │    Обсудить отдельно когда продукт стабилизируется. Архитектура:   │
# │    Claude API + RAG на доке + state UI + deep linking.             │
# │                                                                    │
# │ 3. РЭ.41.d — выбор шаблона (section_structure_preset_id) на        │
# │    'Обзоре' альбома. Требует архитектурного refactor'а             │
# │    AlbumDetailModal (механизм refresh). Прагматично отложено:      │
# │    шаблон меняется редко (1 раз на альбом).                        │
# │                                                                    │
# │ 4. РЭ.37.3.d — вынос soft-чётности helpers в shared.ts + правки    │
# │    students.ts / common-required.ts (зеркальные мастера            │
# │    E-Standard-Left/Right для soft binding). Для Mini/Light/Medium  │
# │    не критично. Делается ПО НЕОБХОДИМОСТИ когда Standard/Universal │
# │    на soft понадобятся.                                            │
# │                                                                    │
# │ 5. Pre-existing 11 fails в тестах:                                 │
# │    - sections-students.test.ts (6)                                 │
# │    - sections-students-grid-semantic.test.ts (3)                   │
# │    - sections-common-additional.test.ts (1)                        │
# │    - sections-transition-combo.test.ts (1)                         │
# │    Унаследовано с РЭ.40 / РЭ.37. Не блокирует, но нужно когда-то   │
# │    почистить — отдельный mini-этап «test baseline cleanup».        │
# │                                                                    │
# │ 6. Названия мастеров — отдельное обсуждение с Сергеем. Возможна    │
# │    унификация / переименование. Влияет на подписи в UI селекторов  │
# │    (сейчас показываем только имена без placeholder'ов).            │
# │                                                                    │
# │ 7. Удалить мёртвые presets с template_set_id IS NULL:              │
# │    custom-qgrz75n3 (Стандарт), custom-l34kwu6p (Мой Мини),         │
# │    custom-vrfxcuqi (Мой пресет для школ).                          │
# │    SQL: DELETE FROM presets WHERE id IN (...).                     │
# │    Эти пресеты не видны в /app/templates (фильтр по designId)      │
# │    но вылазили в TemplatePickerModal как 'Доработай'.              │
# │    Параллельно — на потом — рассмотреть скрытие невалидных         │
# │    presets с NULL template_set_id в TemplatePickerModal.           │
# │                                                                    │
# │ ═══════ КОММИТЫ ЗА V171 (5 шт) ═══════                             │
# │                                                                    │
# │   515d6a8 — feat РЭ.42.a: типы                                     │
# │   d478e34 — feat РЭ.42.b: engine + 8 тестов                        │
# │   2e284ae — feat РЭ.42.b.2: автобиндинг + 5 тестов                 │
# │   3ae448a — feat РЭ.42.c: UI SoftSectionMasterPicker               │
# │   (этот)  — docs: context v171                                     │
# │                                                                    │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО В V170 (25.05.2026, вечер — РЭ.41 частично)             │
# │                                                                    │
# │ UX-улучшение по запросу Сергея: часто меняемые при тестировании    │
# │ настройки сборки перенесены из формы редактирования альбома на     │
# │ вкладку «Обзор» альбома (рядом с превью разворотов).               │
# │                                                                    │
# │ Раньше: чтобы переключить распределение учеников или тип листов,   │
# │ нужно было закрыть Обзор → открыть «Редактировать» → пролистать    │
# │ форму → найти блок → переключить → сохранить → пересобрать.        │
# │                                                                    │
# │ Теперь: всё рядом с превью, переключение в один клик с тостом      │
# │ «Пересоберите альбом чтобы применить».                              │
# │                                                                    │
# │ ═══════ КОММИТЫ ФАЗЫ РЭ.41 (3 шт из 5 запланированных) ═══════     │
# │                                                                    │
# │ feat 40ec484 (РЭ.41.a) — student_distribution: форма → Обзор       │
# │   Новый компонент StudentDistributionControl: 3 кнопки-таб         │
# │   (Авто / Равномерно / Жадно) с optimistic update + rollback.      │
# │   Auto-save через apiVA → update_album. Размещён после             │
# │   CommonSectionLimitControl.                                       │
# │   Удалено из формы редактирования:                                  │
# │     - Поле student_distribution из FormData type                    │
# │     - Default из emptyForm + чтение из БД в openEdit                │
# │     - student_distribution из payload                               │
# │     - UI блок из 3 radio (~75 строк) — заменён комментарием         │
# │                                                                    │
# │ feat 218bd53 (РЭ.41.b) — print_type_override: форма → Обзор        │
# │   Новый компонент PrintTypeOverrideControl: select из 3 опций       │
# │   (Из шаблона / Твёрдые / Мягкие). Send null для сброса.            │
# │   Удалено из формы аналогично .a (поле, default, openEdit, payload, │
# │   UI блок ~25 строк).                                               │
# │                                                                    │
# │ feat c1b343a (РЭ.41.c) — include_non_purchasers: форма → Обзор     │
# │   Новый компонент IncludeNonPurchasersControl: checkbox.            │
# │   Удалено из формы аналогично.                                      │
# │                                                                    │
# │ ═══════ ПАТТЕРН INLINE-КОНТРОЛОВ ═══════                           │
# │                                                                    │
# │ Все три новых контрола следуют единому паттерну, согласованному    │
# │ с существующими VignettesControl и CommonSectionLimitControl:      │
# │                                                                    │
# │   function XxxControl({ album, apiVA, onNotify, onError })         │
# │   1. useState(initialValue из album.props)                          │
# │   2. handleChange: optimistic setValue → apiVA.update_album         │
# │   3. При success: onNotify('… Пересоберите альбом чтобы применить')│
# │   4. При error: rollback setValue + onError                         │
# │                                                                    │
# │ Размещение в JSX на Обзоре (внутри AlbumDetailModal):              │
# │   { canEdit && (config_preset_id || section_structure_preset_id)   │
# │     && <XxxControl ... /> }                                         │
# │                                                                    │
# │ Перед каждым контролом — mt-3 pt-3 border-t border-gray-200,       │
# │ это создаёт визуальный разделитель между настройками.              │
# │                                                                    │
# │ ═══════ НЕ ЗАКРЫТО (отдельный коммит/сессия) ═══════               │
# │                                                                    │
# │ РЭ.41.d — выбор шаблона (section_structure_preset_id) на Обзоре.   │
# │   ОТЛОЖЕНО: требует архитектурного refactor'а AlbumDetailModal.    │
# │   Сейчас модал принимает `album` props без механизма refresh после │
# │   изменения в БД. Если на Обзоре изменить шаблон через apiVA,      │
# │   плашка не обновится без перезагрузки страницы.                   │
# │                                                                    │
# │   Варианты решения (для будущей сессии):                            │
# │   1. Добавить onAlbumChanged callback в AlbumDetailModal который   │
# │      родитель использует для refresh selectedAlbum                  │
# │   2. Дублировать album в локальный state модала с initial из props │
# │   3. Использовать SWR/React Query для автоматического refresh       │
# │                                                                    │
# │   Прагматичная причина отложить: шаблон меняется РЕДКО (1 раз на   │
# │   альбом). Главные UX-pain — распределение/тип/не-заказчики —      │
# │   закрыты в .a/.b/.c. Сергей может пока выбирать шаблон через      │
# │   форму редактирования как раньше.                                  │
# │                                                                    │
# │ ═══════ ПРОВЕРКИ ═══════                                            │
# │                                                                    │
# │ Каждый из трёх коммитов прошёл:                                     │
# │   • npx tsc → пусто                                                 │
# │   • npx next build → зелёный                                        │
# │                                                                    │
# │ Все три новых контрола протестировать на проде после деплоя:        │
# │   • Открыть карточку альбома → вкладка Обзор                       │
# │   • Увидеть три новых inline-блока под существующими VignettesControl│
# │     и CommonSectionLimitControl                                     │
# │   • Переключить → должен быть тост «Пересоберите альбом…»          │
# │   • Перезагрузить страницу → значение должно сохраниться            │
# │   • Открыть «Редактировать» → в форме этих блоков НЕТ              │
# │                                                                    │
# │ ═══════ КОММИТЫ ЗА V170 (4 шт) ═══════                             │
# │                                                                    │
# │   40ec484 — feat РЭ.41.a: StudentDistributionControl               │
# │   218bd53 — feat РЭ.41.b: PrintTypeOverrideControl                 │
# │   c1b343a — feat РЭ.41.c: IncludeNonPurchasersControl              │
# │   (этот) — docs: context v170                                       │
# │                                                                    │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО В V169 (25.05.2026, вечер — РЭ.40 закрыта)              │
# │                                                                    │
# │ Smart distribution алгоритм для grid-сеток учеников.               │
# │ Партнёр в карточке альбома выбирает из 3 режимов как раскладывать  │
# │ учеников по страницам в личном разделе:                            │
# │                                                                    │
# │   auto (DEFAULT) — умное правило: combined+equalize если фото      │
# │     помещается, иначе чистый equalize. Для N=30 mini → [10,10,10]. │
# │   equalize — всегда равномерно. Для N=30 → [10,10,10].              │
# │   greedy — legacy жадно. Для N=30 → [12,12,6] + симметризация.     │
# │                                                                    │
# │ ═══════ КОММИТЫ ФАЗЫ РЭ.40 (11 шт) ═══════                         │
# │                                                                    │
# │ feat 7a4ccb5 (РЭ.40.a) — миграция БД + типы student_distribution   │
# │   • migrations/2026-05-25-albums-student-distribution.sql          │
# │     ALTER TABLE albums ADD COLUMN student_distribution             │
# │       text DEFAULT 'auto' CHECK IN ('auto','equalize','greedy')    │
# │   • Применена на проде Сергеем. 17 существующих альбомов → 'auto'  │
# │   • Поле в RulesAlbumInput, AlbumInput, types/index.ts             │
# │   • legacy-adapter прокидывает в engine                            │
# │                                                                    │
# │ feat 58170e4 (РЭ.40.b) — алгоритм + 43 unit-теста                  │
# │   • lib/rule-engine/sections/distribution.ts (~280 строк)          │
# │     Чистая функция decideDistribution(input) — три режима          │
# │   • lib/rule-engine/__tests__/distribution.test.ts — 43 теста      │
# │   • students.ts buildGrid() переписан через decideDistribution     │
# │   • Удалены legacy pickAdaptiveTail / slotsFromName                │
# │   • adaptiveTailNames в GridConfig оставлен (типовая совместимость)│
# │                                                                    │
# │ feat b206e9f (РЭ.40.c) — UI radio в карточке альбома               │
# │   • app/app/page.tsx: новый блок «Распределение учеников по        │
# │     страницам» с 3 опциями, описаниями, примерами                  │
# │   • FormData student_distribution + emptyForm + загрузка из БД     │
# │   • Submit в update_album payload                                   │
# │                                                                    │
# │ fix aaf4910 — decideDistribution и в buildGridSemantic тоже        │
# │   Найдено Сергеем: 3 режима давали одинаковый результат.           │
# │   Корень: я модифицировал только legacy buildGrid (путь по         │
# │   density), но для пресетов с student_layout_mode='grid' engine    │
# │   идёт через buildGridSemantic. У Сергея пресет именно такой.      │
# │   Решение: buildGridSemantic переписан аналогично buildGrid.       │
# │                                                                    │
# │ fix e08b607 — student_distribution в SELECT smart-fill (КРИТИКА)   │
# │   Найдено Сергеем: 3 режима всё равно дают одинаковый результат.   │
# │   Корень: в lib/smart-fill/build-album-input.ts SELECT album       │
# │   читал только 4 поля. student_distribution не приходил в          │
# │   AlbumInput → всегда подставлялся default 'auto' в engine.        │
# │   Решение: добавил поле в SELECT. Это была самая критичная         │
# │   ошибка фазы — все остальные изменения были невидимы без неё.     │
# │                                                                    │
# │ fix 29b85a9 — фильтр has_portrait для combined-мастера             │
# │   Найдено Сергеем: на хвостовой combined-странице (Light)          │
# │   использовался J-Combined-Tail-4 (transition combo, Mini-стиль)   │
# │   вместо L-Combined-Page. Корень: фильтр был только photos_full=1, │
# │   попадали и J-Combined-Tail-* (без has_portrait/has_name).        │
# │   Решение: жёсткий фильтр has_portrait=true И has_name=true.       │
# │                                                                    │
# │ fix 2da0d99 — отключить legacy-симметризацию в auto/equalize       │
# │   Найдено Сергеем на N=25 + Light + auto: пропал 1 ученик          │
# │   (24 вместо 25) + warning transition_symmetrized.                 │
# │   Корень: в transition.ts функции trySymmetrizeTail и              │
# │   tryReplaceTailWithCombo используют legacy classifyTransitionLayout│
# │   которая считает по жадной формуле (tail = N % maxGrid). Для      │
# │   N=25 Light это даёт tail=1, симметризация POP-ает мои страницы  │
# │   (построенные decideDistribution) и переделывает по legacy,       │
# │   теряя одного.                                                    │
# │   Решение: добавлена проверка mode==='auto' || mode==='equalize'   │
# │   → return false. Через сравнение, не через ?? — это сохраняет     │
# │   legacy для тестов (mode=undefined), но отключает в production    │
# │   (все альбомы после миграции имеют явное значение).               │
# │                                                                    │
# │ fix 5503fa3 — combined-мастер по семейному префиксу                │
# │   Найдено Сергеем после 2da0d99: в auto на хвосте используется     │
# │   N-Combined-Page (Mini) вместо L-Combined-Page (Light) для        │
# │   Light шаблона.                                                   │
# │   Корень: я брал «максимальный по students» combined среди всех    │
# │   подходящих, что для Light выбирало N-Combined (4 > 3).           │
# │   Решение: двухэтапный выбор:                                       │
# │     1) Предпочесть кандидата с тем же семейным префиксом что base  │
# │        (L-Grid-Page → ищем 'L-...' среди combined)                 │
# │     2) Fallback: МИНИМАЛЬНЫЙ по students (раньше брал максимум)    │
# │                                                                    │
# │ ═══════ ИТОГОВАЯ ПРОВЕРКА (JSON от Сергея) ═══════                 │
# │                                                                    │
# │ Альбом Тест с 25 учениками, Light шаблон, mode=auto:               │
# │   spread 3-5: 3 страницы по 6 учеников L-Grid-Page                 │
# │   spread 5:   5 учеников L-Grid-Page (1 hidden, центрирование)     │
# │   spread 6:   2 ученика + classphoto в L-Combined-Page ✓           │
# │   Итого: 6+6+6+5+2 = 25 ✓ Все на месте, единый Light-стиль.        │
# │                                                                    │
# │ Альбом Тест 30 mode=greedy:                                        │
# │   spread 3-4: 2 страницы по 12 N-Grid-Page                         │
# │   spread 5: 6 учеников N-Grid-Page (6 hidden, центрирование)      │
# │   Итого: 12+12+6 = 30 ✓                                            │
# │                                                                    │
# │ ═══════ ДОКУМЕНТАЦИЯ ═══════                                       │
# │                                                                    │
# │ Новый файл docs/designer-master-requests.md — накопительный        │
# │ ТЗ для дизайнера. Разделы:                                          │
# │   1) Хвостовые мастера N-Grid-Page-10/9/8/7/6 + L-Grid-Page-5/4/3  │
# │      (для visual 4+3+3 вместо 4+4+2)                                │
# │   2) Семантика slot_capacity (различение student-combined vs        │
# │      transition-combo через has_portrait+has_name)                  │
# │   3) Combo-мастера для симметризации (greedy + Light → J-Combined- │
# │      Tail-3 имеет Mini-стиль; два пути решения зафиксированы)      │
# │                                                                    │
# │ ═══════ ИЗВЕСТНО НЕ ЗАКРЫТО ═══════                                │
# │                                                                    │
# │ • greedy + Light: на симметризованном хвосте используется           │
# │   J-Combined-Tail-3 (Mini-стиль). Решение зафиксировано в ТЗ        │
# │   дизайнеру (раздел 3). Можно либо нарисовать L-J-Combined-Tail-N, │
# │   либо переделать trySymmetrizeTail на *-Combined-Page. Сергею     │
# │   нужно выбрать путь.                                               │
# │ • Визуальная компоновка 4+3+3 (вместо 4+4+2) для 10 фото —          │
# │   дизайнерская задача, ТЗ записано (раздел 1).                      │
# │ • 5 legacy-тестов упали намеренно после удаления адаптивных         │
# │   мастеров (L-2/3/4/N-4/6/9). Переписать в отдельном коммите если  │
# │   потребуется.                                                      │
# │                                                                    │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО В V168 (25.05.2026, поздний вечер — финал)              │
# │                                                                    │
# │ Серия фиксов после первой реальной прокатки клонирования +         │
# │ подготовка эталонного альбома Тест2 для фазы D.                    │
# │                                                                    │
# │ ═══════ ФИКСЫ КЛОНИРОВАНИЯ (РЭ.39 follow-up) ═══════               │
# │                                                                    │
# │ fix 64619ca — quotes НЕ копируются                                 │
# │   Сергей нажал «Клонировать» — упало с ошибкой                     │
# │   'column quotes.album_id does not exist'.                          │
# │   Корневая причина: я ошибочно думал что quotes привязаны через    │
# │   album_id. На самом деле quotes.tenant_id — это партнёрская       │
# │   общая база (один пул цитат на весь tenant, не на альбом).        │
# │   Решение: убрать блок копирования quotes из album_clone.          │
# │   В quote_selections (10f) переадресуем только child_id; quote_id  │
# │   оставляем как есть — копия использует те же цитаты из общей      │
# │   базы tenant'а.                                                   │
# │                                                                    │
# │ fix 70436c0 — копировать submitted_at / started_at                 │
# │   После исправления quotes Сергей создал копию — она появилась,    │
# │   но на дашборде показывала «0 из 25 учеников» / 0%, хотя          │
# │   selections (125), photo_children (125), фото — всё перенеслось.  │
# │   Открытие родительской ссылки в копии показывало выбор фото      │
# │   правильно (значит ДАННЫЕ в БД есть).                              │
# │                                                                    │
# │   Корневая причина: первая версия album_clone сознательно НЕ       │
# │   копировала children.submitted_at / started_at — «копия начинает  │
# │   с чистого листа». Дашборд использует именно эти поля для        │
# │   расчёта прогресса (submitted_at IS NOT NULL → 'Готово'). В копии │
# │   всё было NULL → прогресс 0%.                                     │
# │                                                                    │
# │   Решение: копировать submitted_at и started_at из source во все   │
# │   3 таблицы — children, teachers, responsible_parents. Теперь      │
# │   копия выглядит идентично оригиналу в UI.                          │
# │                                                                    │
# │ ═══════ ФИКС ENGINE (headtextframe) ═══════                       │
# │                                                                    │
# │ fix c0e152a — engine биндит teachers.description в headtextframe   │
# │   В эталонном альбоме у классрука Орловой Е.С. был текст-          │
# │   напутствие 492 симв в teachers.description, но в layout слот     │
# │   справа от портрета (label='headtextframe') рендерился пустым.   │
# │                                                                    │
# │   Корневая причина: lib/rule-engine/sections/teachers.ts знал      │
# │   только labels 'headteachertext' и 'headteacherquote'. Label      │
# │   'headtextframe' (из IDML-мастеров Сергея) НЕ распознавался →     │
# │   bindings[ph.label] не создавался → Canvas рисовал пустой         │
# │   placeholder.                                                      │
# │                                                                    │
# │   Старый legacy путь build-from-preset.ts уже знал про              │
# │   headtextframe (строка 1682). При переписке на rule-engine        │
# │   teachers.ts алиас потерялся.                                      │
# │                                                                    │
# │   Решение: добавлен 3-й алиас в bindLeftPage:                       │
# │     label === 'headteachertext'                                    │
# │     || label === 'headteacherquote'                                │
# │     || label === 'headtextframe'                                   │
# │                                                                    │
# │   33/33 teachers тестов прошли, регрессий нет.                     │
# │                                                                    │
# │ ═══════ ЭТАЛОННЫЙ АЛЬБОМ ТЕСТ2 ГОТОВ ═══════                       │
# │                                                                    │
# │ Для фазы D подготовлен эталонный альбом Тест2 (album_id =          │
# │ def23fce-5dfd-46d5-832e-efabe886b3ce). Принцип: один заполненный   │
# │ альбом → клонировать сколько угодно копий → менять параметры на    │
# │ копиях для прокатки сценариев.                                     │
# │                                                                    │
# │ seed 70ace4a — миграция 2026-05-25-seed-test2-reference-album.sql  │
# │   • Добавлены 5 новых учеников (NOT EXISTS — идемпотентно):        │
# │     Морозов Никита, Никитина Полина, Орлов Максим,                 │
# │     Петрова Виктория, Соколов Кирилл                               │
# │   • Тексты ~100-125 симв всем 30 ученикам в student_texts          │
# │     (ON CONFLICT (child_id) DO NOTHING — не перезаписывает)        │
# │   • Текст-напутствие 492 симв классруку Орловой Е.С. в             │
# │     teachers.description (UPDATE WHERE IS NULL OR '')              │
# │                                                                    │
# │ seed b46f22b — миграция 2026-05-25-seed-test2-new-students-photos.sql │
# │   В альбоме 36 портретов (type='portrait'), новые 5 учеников       │
# │   были без привязки → пустые слоты в layout.                       │
# │   Скрипт привязывает 5 свободных портретов:                        │
# │     DSC08430 → Морозов Никита                                      │
# │     DSC08432 → Никитина Полина                                     │
# │     DSC08436 → Орлов Максим                                        │
# │     DSC08439 → Петрова Виктория                                    │
# │     DSC08440 → Соколов Кирилл                                      │
# │   Для каждого:                                                     │
# │     • photo_children (тэг «кто на фото»)                           │
# │     • selections (selection_type='portrait_page')                  │
# │     • children.submitted_at = NOW (статус «Готово»)                │
# │                                                                    │
# │ ИТОГО ЭТАЛОН СОДЕРЖИТ:                                             │
# │   • 30 учеников (25 исходных + 5 новых)                            │
# │   • 30 текстов от родителей                                        │
# │   • Текст 492 симв у классрука (рендерится в headtextframe ✓)     │
# │   • Все 30 учеников submitted_at = NOW → прогресс 100%             │
# │   • Все 30 имеют выбранный портрет + тэг в photo_children          │
# │   • 36 портретов, 150 группы, 6 common_full, 30 common_sixth,      │
# │     6 common_half, 8 common_quarter, 1 common_spread, 5 teacher    │
# │                                                                    │
# │ ═══════ ЧТО БЫЛО ЗАПЛАНИРОВАНО ПОСЛЕ V169 (часть выполнена в V170) ═══════ │
# │                                                                    │
# │ РЭ.40 ЗАКРЫТА. Партнёр (Сергей) теперь имеет 3 режима               │
# │ распределения учеников по grid-сеткам (auto / equalize / greedy)   │
# │ + рабочий выбор combined-мастера + отключение legacy-симметризации │
# │ в умных режимах.                                                    │
# │                                                                    │
# │ После v169 Сергей попросил UX-улучшение: часто меняемые при        │
# │ тестировании настройки сборки → на Обзор. Это сделано в РЭ.41.a/b/c │
# │ (см. блок V170 выше).                                               │
# │                                                                    │
# │ Параллельно можно тестировать:                                     │
# │   • РЭ.37.8 — Сергей рисует combo-мастера в InDesign (внешнее)     │
# │   • Сценарии разных N × разные шаблоны через клонирование Тест2    │
# │                                                                    │
# │ TODO короткого срока:                                              │
# │   • Дать ответ Сергею про combo для симметризации (раздел 3 в      │
# │     docs/designer-master-requests.md): новые мастера или код-фикс  │
# │   • Нарисовать N-Grid-Page-10/9/8/7/6 + L-Grid-Page-5/4/3 для       │
# │     визуально гармоничного 4+3+3 (раздел 1 ТЗ дизайнеру)            │
# │   • Возможно — переписать 5 legacy-тестов которые упали после       │
# │     удаления адаптивных мастеров                                    │
# │                                                                    │
# │ TODO долгосрочного:                                                │
# │   • Этап 4.c (редирект /admin → /app) — только по команде Сергея   │
# │   • Этап 4.d (удаление legacy кода) — только по команде             │
# │   • Рефакторинг api-client: мигрировать app/app/page.tsx и         │
# │     app/app/album/[id]/layout/page.tsx на общий fetch wrapper      │
# │                                                                    │
# │ Сценарии фазы D (через клонирование Тест2):                        │
# │   • 5/13/25/30 учеников × Light/Mini/Medium/Standard               │
# │   • layflat и soft                                                  │
# │   • С custom transition-сценарием и без                            │
# │   • С симметризацией и без (Сергей это в v169 уже частично проверил)│
# │                                                                    │
# │ КОММИТЫ ЗА V169 (11 шт):                                           │
# │   РЭ.40 основные:                                                   │
# │   7a4ccb5 — feat РЭ.40.a: миграция БД + типы                        │
# │   58170e4 — feat РЭ.40.b: алгоритм decideDistribution + 43 теста   │
# │   b206e9f — feat РЭ.40.c: UI radio в карточке альбома              │
# │                                                                    │
# │   РЭ.40 фиксы (по реальному тестированию Сергея):                  │
# │   aaf4910 — fix: decideDistribution в buildGridSemantic            │
# │   e08b607 — fix: student_distribution в SELECT smart-fill          │
# │   29b85a9 — fix: фильтр has_portrait для combined                  │
# │   2da0d99 — fix: отключить симметризацию в auto/equalize           │
# │   5503fa3 — fix: combined по семейному префиксу                    │
# │                                                                    │
# │   Документация:                                                     │
# │   d344509 — docs: первая версия ТЗ дизайнеру                       │
# │   722cbe9 — docs: семантика slot_capacity                          │
# │   07380c3 — docs: ТЗ дизайнеру переписан + раздел 3                │
# │                                                                    │
# │   Этот контекст:                                                    │
# │   (этот коммит) — docs: context v169                                │
# │                                                                    │
# │ КОММИТЫ V168 (10 шт) — оставлены ниже для истории:                 │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ИСТОРИЯ — ЧТО БЫЛО В V168 (25.05.2026 поздний вечер)               │
# │                                                                    │
# │ Сергей теперь может:                                               │
# │   1. Клонировать Тест2 — копия идентична оригиналу.                │
# │   2. На копии менять пресет / комплектацию / удалять учеников.    │
# │   3. Пересобирать layout, проверять что engine делает корректно.   │
# │                                                                    │
# │ КОММИТЫ ЗА V168 (10 шт):                                           │
# │   РЭ.37.6:                                                          │
# │   a35c3e2 — миграция БД (presets.transition_scenario)              │
# │   94dfe8f — API endpoints                                          │
# │   6df6e13 — engine fillPresetCustomScenario + 7 тестов             │
# │   fdae7f0 — UI TransitionScenarioPicker                            │
# │   953a50a — context v166                                           │
# │                                                                    │
# │   РЭ.39:                                                            │
# │   6cde6d5 — backend album_clone (~600 строк, 14 таблиц)            │
# │   68210d9 — UI «Клонировать альбом»                                 │
# │   eb7177e — context v167                                           │
# │                                                                    │
# │   Фиксы и эталон:                                                   │
# │   64619ca — fix: убрать quotes из album_clone                      │
# │   70436c0 — fix: копировать submitted_at в копию                   │
# │   c0e152a — fix engine: headtextframe label                        │
# │   70ace4a — seed: тексты эталонного альбома                        │
# │   b46f22b — seed: фото для 5 новых учеников                        │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V167 (25.05.2026)                                       │
# │                                                                    │
# │ РЭ.39 — КЛОНИРОВАНИЕ АЛЬБОМА                                       │
# │                                                                    │
# │ Сергей попросил функцию: при тестировании нужны несколько копий   │
# │ одного и того же альбома (с разными настройками), чтобы быстро    │
# │ прокатывать сценарии. Также реальный бизнес-кейс — разделить      │
# │ класс на две группы для разных дизайнов/комплектаций.             │
# │                                                                    │
# │ ДВА ПОДЭТАПА:                                                      │
# │                                                                    │
# │   РЭ.39.a (commit 6cde6d5) — backend endpoint album_clone          │
# │     В app/api/tenant/route.ts между create_album и update_album.   │
# │     ~600 строк.                                                    │
# │                                                                    │
# │     Тело запроса: { action: 'album_clone',                         │
# │                     source_album_id: string,                       │
# │                     new_title?: string }                           │
# │                                                                    │
# │     Алгоритм (12 шагов, fail-fast с rollback):                     │
# │       1. Проверка роли (не viewer) + source существует             │
# │       2. Проверка лимита тарифа max_albums                         │
# │       3. Создание копии albums row (с теми же настройками          │
# │          пресета — config_preset_id, section_structure_preset_id,  │
# │          template_set_id, print_type — партнёр потом сам может     │
# │          сменить)                                                  │
# │       4. Копирование children (без access_token → БД генерирует    │
# │          новый из DEFAULT). Map oldId→newId.                       │
# │       5. Копирование teachers (новые токены через DEFAULT).        │
# │          Map oldId→newId.                                          │
# │       6. Копирование responsible_parents (новые токены).           │
# │       7. Копирование photos — метаданные, storage_path тот же      │
# │          (файлы на бакете immutable, не дублируем). Map oldId→     │
# │          newId.                                                    │
# │       8. Копирование original_photos (для печати).                  │
# │       9. Копирование quotes (цитаты пресета). Map oldId→newId.    │
# │       10. Дочерние таблицы через child_id:                         │
# │           • student_texts (тексты от родителей)                    │
# │           • parent_contacts (контакты)                             │
# │           • selections (выбор фото) — переадресация child_id +     │
# │             photo_id через map'ы                                   │
# │           • photo_children (теги «кто на фото») — upsert с         │
# │             ignoreDuplicates на (photo_id, child_id)              │
# │           • cover_selections (выбор обложки)                       │
# │           • quote_selections (выбор цитаты)                        │
# │           • personal_spread_photos (личные развороты)              │
# │       11. photo_teachers (через teacher_id + photo_id).            │
# │       12. logAction('album.clone', ...) + возврат                  │
# │           { id, title, stats: { children, teachers, photos,        │
# │             quotes } }                                              │
# │                                                                    │
# │     НЕ копируется:                                                 │
# │       • album_layouts — пересоберётся с нуля. Если партнёр         │
# │         сменит пресет в копии, layout будет другим.                │
# │       • invitations, photo_locks (временные токены).               │
# │       • album_exports, delivery_files (PDF-экспорты).              │
# │       • children.submitted_at / started_at — статусы прогресса     │
# │         сбрасываются (копия начинает с чистого листа).             │
# │       • audit_log (но факт клонирования логируется отдельно).      │
# │                                                                    │
# │     ТРАНЗАКЦИОННОСТЬ: Supabase JS не поддерживает явные TX. При    │
# │     первой же ошибке на дочерней таблице удаляем новый albums row  │
# │     через DELETE — БД через CASCADE удаляет все FK-зависимости.    │
# │                                                                    │
# │     ТОКЕНЫ: По решению Сергея — новые токены для всех (родители,  │
# │     учителя, ответственные). Старые ссылки родителей продолжают   │
# │     работать с оригиналом, копия изолирована.                      │
# │                                                                    │
# │   РЭ.39.b (commit 68210d9) — UI кнопка «Клонировать»               │
# │     В app/app/page.tsx, компонент AlbumFormModal.                  │
# │                                                                    │
# │     State: showCloneConfirm (boolean).                             │
# │     Handler handleClone(): POST action='album_clone' → onSuccess   │
# │     с названием копии при успехе, onError при ошибке.              │
# │                                                                    │
# │     UI: кнопка «📋 Клонировать альбом» перед блоком архивации     │
# │     (полезное действие первым). При клике — голубой блок          │
# │     подтверждения:                                                 │
# │       'Будет создан альбом «{title} — копия» со всеми фото,        │
# │        выбором фото, текстами от родителей, учителями и            │
# │        настройками. Layout пересоберётся при первом просмотре      │
# │        копии. Ссылки родителей в копии будут новыми (старые        │
# │        продолжат работать с оригиналом).'                          │
# │     Кнопки: 'Да, создать копию' / 'Отмена'.                        │
# │                                                                    │
# │     Доступно только для активных альбомов (!album.archived).       │
# │                                                                    │
# │ ПРОВЕРКИ:                                                          │
# │   • npx tsc → пусто                                                │
# │   • npx next build → зелёный                                       │
# │   • npx vitest run → 639/644 (без регрессий; на этот endpoint     │
# │     тестов нет — проверка на проде. Mock-Supabase в проекте        │
# │     не настроен, было бы избыточно для одной фичи)                 │
# │                                                                    │
# │ СЦЕНАРИЙ ПРИЁМКИ НА ПРОДЕ:                                         │
# │   1. Открыть существующий альбом → edit модалка → прокрутить вниз. │
# │   2. Перед блоком архивации видна кнопка '📋 Клонировать альбом'.  │
# │   3. Нажать → подтверждение в голубом блоке.                       │
# │   4. Нажать 'Да, создать копию' → loading → toast 'Создана копия:  │
# │      <название>'.                                                  │
# │   5. В списке альбомов появилась копия с заголовком                │
# │      '<original> — копия'.                                         │
# │   6. Открыть копию → ученики, учителя, фото, выбор фото, тексты   │
# │      родителей на месте.                                            │
# │   7. Layout пересоберётся при первом просмотре копии в редакторе.  │
# │                                                                    │
# │ ВОЗМОЖНЫЕ EDGE CASES (на проде проверить):                         │
# │   • Очень большой альбом (50+ фото, 30+ учеников) — все INSERT     │
# │     батчевые, должно быть быстро. Если будет медленно — можно      │
# │     добавить chunked-insert.                                        │
# │   • Альбом с personal_spread_enabled=true и заполненными           │
# │     personal_spread_photos — должны скопироваться все привязки.    │
# │   • Альбом с архивацией — кнопка скрыта (правильно).               │
# │   • Альбом другого партнёра — 403 (правильно).                     │
# │   • Лимит max_albums достигнут — 403 (правильно).                  │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ                                                         │
# │ ──────────                                                         │
# │                                                                    │
# │ Сергей сначала проверит endpoint на проде (1-2 клонирования с      │
# │ разными альбомами), потом продолжит D — реальное тестирование      │
# │ с прокатанными альбомами:                                          │
# │                                                                    │
# │   • 5/13/25/30 учеников × разные комплектации × layflat/soft       │
# │   • С custom transition-сценарием и без                            │
# │   • С симметризацией и без                                         │
# │                                                                    │
# │ Если в процессе клонирования вылезут проблемы — фиксим по факту.   │
# │                                                                    │
# │ Параллельно: РЭ.37.8 — Сергей рисует combo-мастера в InDesign.    │
# │ Внешняя работа, моего кода не требует.                             │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V166 (25.05.2026)                                       │
# │                                                                    │
# │ РЭ.37.6 ПОЛНОСТЬЮ ЗАКРЫТА — UI TRANSITIONSCENARIOPICKER             │
# │                                                                    │
# │ Большая фича в 4 подэтапа: ручной сценарий transition-разворота.   │
# │ По умолчанию (NULL в БД) engine использует OkeyBook-логику. Если   │
# │ партнёр в UI редактора пресета выбрал 'Вручную' — engine кладёт    │
# │ явно указанные master_id вместо автомата.                          │
# │                                                                    │
# │ Сергей выбрал упрощённый вариант A:                                │
# │   • 3 селектора (tail_left, tail_right, closing) — closing пока    │
# │     резерв, не используется engine'ом                              │
# │   • симметризация в custom-режиме ИГНОРИРУЕТСЯ                     │
# │   • при необходимости симметризацию в custom можно добавить позже  │
# │                                                                    │
# │ ЧЕТЫРЕ ПОДЭТАПА:                                                   │
# │                                                                    │
# │   РЭ.37.6.a (commit a35c3e2) — миграция БД                         │
# │     ALTER TABLE presets ADD COLUMN transition_scenario JSONB NULL  │
# │     + CHECK constraint presets_transition_scenario_valid:          │
# │       • mode ∈ {'default', 'custom'}                               │
# │       • если mode='custom', хотя бы один master_id не null         │
# │     Сергей применил миграцию на проде, проверка пройдена:          │
# │       all 5 presets transition_scenario IS NULL ✓                  │
# │       constraint существует ✓                                      │
# │                                                                    │
# │   РЭ.37.6.b (commit 94dfe8f) — API endpoints                       │
# │     • rule_presets_list возвращает transition_scenario             │
# │     • rule_preset_update принимает transition_scenario             │
# │       с полной валидацией (mode, типы master_id, allNull-check)    │
# │     • API нормализует mode='default' → null (упрощает чтение в    │
# │       engine'е)                                                    │
# │     • Дублирует CHECK constraint для дружелюбных 400 ответов       │
# │                                                                    │
# │   РЭ.37.6.c (commit 6df6e13) — engine + типы + тесты               │
# │     • Тип TransitionScenario (discriminated union по mode)         │
# │     • Поле Preset.transition_scenario                               │
# │     • loaders.ts: parseTransitionScenario safety-парсер            │
# │     • fillTransitionSection: раннее ветвление — если preset        │
# │       задал custom, идём в fillPresetCustomScenario, минуя         │
# │       OkeyBook-default и section_structure mode='custom'           │
# │       (это другая фича РЭ.37.2.c)                                  │
# │     • fillPresetCustomScenario (~200 строк):                       │
# │       – Шаг 1: tail_left_master_id                                 │
# │         · POP последней students-страницы                          │
# │         · Восстанавливаем available.full_class если был classphoto │
# │         · Найти мастер по id (scan по mastersByName, не by name)   │
# │         · Анализ placeholder'ов нового мастера:                    │
# │           ◦ studentportrait_N? → grid/combo (pushGridPage или      │
# │             pushCombinedTailPage с tail-учениками из popped)       │
# │           ◦ Иначе → common-мастер (bindCommonPhotos +              │
# │             decrementAvailable по категории halfphoto/collagephoto/│
# │             quarterphoto/classphotoframe/spreadphoto)              │
# │           ◦ J-Spread → warning + skip (transition spread пока      │
# │             не поддерживаем)                                       │
# │         · master_id не найден → warning transition_custom_master_  │
# │           not_found, popped возвращается на место                  │
# │       – Шаг 2: tail_right_master_id                                │
# │         · Если задан И правая висит — PUSH мастер через            │
# │           bindCommonPhotos + decrement                              │
# │         · Если задан И правая занята — warning skipped              │
# │         · Если не задан И правая висит — tryJChainClosing (старое  │
# │           поведение OkeyBook closing)                              │
# │         · master_id не найден → warning + tryJChainClosing fallback│
# │     • +7 тестов в sections-transition-combo                        │
# │                                                                    │
# │   РЭ.37.6.d (commit fdae7f0) — UI компонент                        │
# │     • Локальный тип TransitionScenario в PresetEditorModal         │
# │       (зеркало rule-engine типа, не тянем engine в client-bundle)  │
# │     • State: transitionMode + transitionTailLeftId +               │
# │       transitionTailRightId                                        │
# │     • Save body отправляет в API:                                  │
# │       mode='default' → null                                        │
# │       mode='custom' → {mode, tail_left_master_id, tail_right_      │
# │       master_id, closing_master_id: null}                          │
# │     • UI блок 'Переходный разворот' между 'Личный раздел' и        │
# │       section_structure редактором:                                │
# │       – Radio 'По умолчанию' / 'Вручную — мой сценарий'            │
# │       – В custom-режиме: 2 селекта (L и R страница) с мастерами    │
# │         из template_set                                            │
# │       – Опция '—' в каждом селекте = «не задано» (старое поведение│
# │         для этой стороны)                                          │
# │       – Если оба поля пустые — info-warning «это равнозначно       │
# │         По умолчанию»                                              │
# │       – Если template_set_id NULL — warning «сначала выберите      │
# │         дизайн»                                                    │
# │     • app/app/templates/[designId]/page.tsx: EditableP mapping     │
# │       включает transition_scenario (TS error без этого)            │
# │                                                                    │
# │ ПРОВЕРКИ:                                                          │
# │   • npx tsc → пусто                                                │
# │   • npx next build → зелёный                                       │
# │   • npx vitest run → 639/644 (baseline 632/637 + 7 новых тестов    │
# │     для custom scenario, те же 5 pre-existing fails)               │
# │                                                                    │
# │ СЦЕНАРИЙ ПРИЁМКИ НА ПРОДЕ:                                         │
# │   1. /super/presets → открыть любой пресет с template_set_id.      │
# │   2. Увидеть новую секцию 'Переходный разворот'. Radio по          │
# │      умолчанию на 'По умолчанию'.                                  │
# │   3. Переключить на 'Вручную' → раскрылся блок с 2 селектами.      │
# │   4. Выбрать например J-Half для левой → сохранить.                │
# │   5. Создать тестовый альбом с этим пресетом (≥13 учеников для    │
# │      Light → tail=1) → проверить что на transition layout L =      │
# │      J-Half вместо combo.                                          │
# │   6. Decision trace должен содержать preset_custom_scenario:start. │
# │   7. Вернуться в редактор → переключить на 'По умолчанию' →        │
# │      сохранить → пересобрать → старое OkeyBook поведение           │
# │      восстановлено.                                                │
# │                                                                    │
# │ ИТОГ ФАЗЫ РЭ.37 — ПОЛНОСТЬЮ ЗАКРЫТА:                              │
# │   ✅ РЭ.37.1 (схема БД symmetrize)                                 │
# │   ✅ РЭ.37.2 (engine combo replacement)                            │
# │   ✅ РЭ.37.3 (миграция БД + soft binding + sixth-first приоритет)  │
# │   ✅ РЭ.37.4 (engine симметризация)                                │
# │   ✅ РЭ.37.4.b (симметризация через preset для legacy)             │
# │   ✅ РЭ.37.5 (UI галочка симметризации)                            │
# │   ✅ РЭ.37.5.b (автоцентрирование)                                 │
# │   ✅ РЭ.37.6 (UI TransitionScenarioPicker)                         │
# │   ✅ РЭ.37.7 (большой регрессионный набор тестов)                  │
# │   ✅ РЭ.37.9 (quote fallback)                                      │
# │   ─────────────                                                    │
# │   ⏳ РЭ.37.8 (Сергей рисует combo-мастера в InDesign) — внешнее    │
# │                                                                    │
# │ ВОЗМОЖНЫЕ ПОДЭТАПЫ В БУДУЩЕМ (по запросу):                         │
# │   • РЭ.37.6.e — симметризация в custom-режиме                      │
# │     (сейчас игнорируется; добавим если партнёрам понадобится)      │
# │   • РЭ.37.6.f — использование closing_master_id (резерв в БД +     │
# │     типе, пока engine его не читает)                               │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ                                                         │
# │ ──────────                                                         │
# │                                                                    │
# │   D — РЕАЛЬНОЕ ТЕСТИРОВАНИЕ на проде с разными альбомами:         │
# │       прокатить 5/13/25/30 учеников × разные комплектации ×        │
# │       layflat/soft. Может всплыть что-то неочевидное.              │
# │                                                                    │
# │   РЭ.37.8 — Сергей рисует combo-мастера в InDesign. Внешняя        │
# │     работа, моего кода не требует. Параллельно с тестированием.    │
# │                                                                    │
# │ Сергей решает следующий шаг.                                       │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V165 (25.05.2026)                                       │
# │                                                                    │
# │ РЭ.37.9 + РЭ.37.7 ЗАКРЫТЫ                                          │
# │                                                                    │
# │ После РЭ.37.5.b Сергей сделал ещё один тест — на плотных листах с │
# │ template_set «Белый плотные разворотами», 25 учеников, Light с    │
# │ цитатами. Результат: личный раздел вообще не собрался,            │
# │ degraded warning students_master_not_found.                        │
# │                                                                    │
# │ Корневая причина: в этом template_set нет мастера-сетки на 6      │
# │ учеников С ЦИТАТАМИ. buildGridSemantic делал early return без     │
# │ fallback. Та же архитектурная дыра что лечили в common_required   │
# │ через fallback chain (РЭ.38.1).                                    │
# │                                                                    │
# │ РЭ.37.9 — quote fallback (commit 7b48270)                          │
# │   В buildGridSemantic если поиск с hasQuote=true вернул null —    │
# │   пробуем hasQuote=false. Лучше построить альбом без цитат, чем   │
# │   не построить вовсе. effectiveHasQuote передаётся всем          │
# │   последующим find-вызовам (combined-tail, adaptive).             │
# │                                                                    │
# │   Info-warning students_quote_fallback с понятным объяснением:     │
# │     'в дизайне нет мастера-сетки на N учеников с цитатами под     │
# │      каждым — взят мастер без цитат («L-Grid-Page»). Цитаты       │
# │      учеников не показаны. Чтобы вернуть цитаты, выберите другой  │
# │      дизайн шаблона или закажите кастомный мастер у дизайнера.'   │
# │                                                                    │
# │   Decision trace: grid_semantic:quote_fallback:<master_name>       │
# │                                                                    │
# │   Если и без цитат не нашли — старое поведение (warning + return), │
# │   но сам warning теперь говорит has_quote=true ИЛИ false.          │
# │                                                                    │
# │   +3 теста в sections-students-grid-semantic.                      │
# │                                                                    │
# │ Эффект на Тест2:                                                   │
# │   После пересборки: 14 элементов, 3 info warnings (все info,      │
# │   плашка «К сведению»). На L-Grid-Page без цитат + симметризация  │
# │   + центрирование — всё сработало.                                 │
# │   Сергей: «Все отлично, хорошо все собралось.»                     │
# │                                                                    │
# │ ─── РЭ.37.7 — БОЛЬШОЙ РЕГРЕССИОННЫЙ НАБОР ───────────────────────  │
# │                                                                    │
# │ Закрывает фазу регрессионных тестов (commit 49291ca).              │
# │ Файл: lib/rule-engine/__tests__/transition-regression.test.ts      │
# │                                                                    │
# │ Структура — 36 тестов:                                             │
# │                                                                    │
# │   Матрица из xlsx (28 кейсов):                                     │
# │     • Мини плотные/мягкие (grid=12): 6 кейсов                     │
# │     • Лайт плотные/мягкие (grid=6): 8 кейсов                      │
# │     • Медиум плотные/мягкие (grid=4): 8 кейсов                    │
# │     • Стандарт/Универсал (page): 6 кейсов                         │
# │                                                                    │
# │   Новые фичи поверх (8 кейсов):                                    │
# │     • Симметризация хвоста: 5 тестов                              │
# │     • Автоцентрирование: 1 тест                                   │
# │     • Quote fallback: 1 тест                                      │
# │     • Legacy combined-tail (Тест2-сценарий): 1 тест               │
# │                                                                    │
# │ РАСХОЖДЕНИЯ С XLSX (зафиксированы в шапке файла):                 │
# │   Engine использует min_fit для адаптивного хвоста (РЭ.22.6):     │
# │   берёт минимально-достаточный мастер, а не «верхний/нижний       │
# │   предел диапазона» из xlsx. Это правильно — меньше пустых       │
# │   слотов, компактнее вёрстка. Тесты фиксируют ФАКТИЧЕСКОЕ         │
# │   поведение engine, не xlsx. Это позволяет ловить регрессии при   │
# │   изменении логики.                                                │
# │                                                                    │
# │ Архитектурное наблюдение во время разработки:                     │
# │   Combo-мастера разных размеров (Tail-2/3/4) НЕЛЬЗЯ смешивать    │
# │   в одном bundle — иначе students.ts через min_fit для tail=1     │
# │   возьмёт самый компактный (Tail-2), а это сломает определение   │
# │   комплектации через detectComplectationFromLastPage. В реальных │
# │   template_set каждая комплектация имеет свой combo. В тестах    │
# │   отдельные bundles: LIGHT_MASTERS / MINI_MASTERS / MEDIUM_MASTERS.│
# │                                                                    │
# │ Maximum (spread-режим) НЕ покрыт — есть pre-existing issues       │
# │ (5 fails в общей suite), это отдельная задача (РЭ.37.8 или        │
# │ позже).                                                            │
# │                                                                    │
# │ ПРОВЕРКИ:                                                          │
# │   • npx tsc → пусто                                                │
# │   • npx next build → зелёный                                       │
# │   • npx vitest run → 632/637 (baseline 596/601 + 36 новых,        │
# │     те же 5 pre-existing fails)                                    │
# │                                                                    │
# │ ИТОГ ФАЗЫ РЭ.37 — почти полностью закрыта:                        │
# │   ✅ РЭ.37.1 (схема БД)                                            │
# │   ✅ РЭ.37.2 (engine combo replacement)                            │
# │   ✅ РЭ.37.3 (миграция БД + soft binding + sixth-first приоритет)  │
# │   ✅ РЭ.37.4 (engine симметризация)                                │
# │   ✅ РЭ.37.4.b (симметризация через preset для legacy)             │
# │   ✅ РЭ.37.5 (UI галочка)                                           │
# │   ✅ РЭ.37.5.b (автоцентрирование)                                 │
# │   ✅ РЭ.37.7 (большой регрессионный набор тестов)                  │
# │   ✅ РЭ.37.9 (quote fallback)                                      │
# │   ─────────────                                                    │
# │   ⏳ РЭ.37.6 (UI TransitionScenarioPicker — ручной custom)         │
# │   ⏳ РЭ.37.8 (Сергей рисует combo-мастера в InDesign) — внешнее    │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ                                                         │
# │ ──────────                                                         │
# │                                                                    │
# │   Вариант B — РЭ.37.6 (UI custom scenario, M).                    │
# │     Компонент TransitionScenarioPicker: radio «По умолчанию /     │
# │     Вручную». В custom-режиме партнёр выбирает мастера для        │
# │     tail_left/right/closing вручную. Требует новое поле в БД +    │
# │     расширение transition.ts.                                      │
# │                                                                    │
# │   Вариант D — тестировать в реальной работе.                      │
# │     Прокатить несколько разных альбомов (5/13/25/30 учеников,     │
# │     разные комплектации) и собрать обратную связь.                │
# │                                                                    │
# │   Вариант C — РЭ.37.8 (Сергей рисует InDesign-мастера).            │
# │     Внешняя работа, моего кода не требует. Параллельно с B.       │
# │                                                                    │
# │ Сергей решает следующий шаг.                                       │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V164 (25.05.2026)                                       │
# │                                                                    │
# │ РЭ.37.4.b + РЭ.37.5.b — ДВА ПОСТ-ФИКСА СИММЕТРИЗАЦИИ              │
# │                                                                    │
# │ После принятия РЭ.37.4 на Тест2 (включил галку) Сергей обнаружил   │
# │ что симметризация НЕ срабатывает: warnings показывают              │
# │ transition_complectation_unknown, layout остался как был (один     │
# │ ученик в углу).                                                    │
# │                                                                    │
# │ Корневая причина (РЭ.37.4.b — commit f73a29e):                     │
# │   trySymmetrizeTail вызывалась только если                         │
# │   detectComplectationFromLastPage вернула не-null. На Тест2        │
# │   students.ts (semantic-grid) кладёт legacy L-Combined-Page имя    │
# │   которого engine не распознаёт → complectation=null → early       │
# │   return → симметризация даже не пробуется.                        │
# │                                                                    │
# │ Решение РЭ.37.4.b — определять complectation через preset:         │
# │   • student_layout_mode='grid' + student_grid_size=12 → mini       │
# │     student_layout_mode='grid' + student_grid_size=6  → light      │
# │   • Fallback для legacy-пресетов где новые поля null:              │
# │     density='mini' → mini, density='light' → light                 │
# │                                                                    │
# │   Если presetComplectation определена, в блоке `if (!complectation)` │
# │   строится layoutFromPreset через classifyTransitionLayout и       │
# │   вызывается trySymmetrizeTail. При успехе: closing + return,      │
# │   warning unknown НЕ пишется. Decision trace помечен               │
# │   'okeybook_default:symmetrize_from_preset'.                       │
# │                                                                    │
# │   +2 теста: Light 25 + legacy L-Combined-Page + symmetrize=true    │
# │   (срабатывает) и symmetrize=false (старое поведение).             │
# │                                                                    │
# │ Эффект на Тест2:                                                   │
# │   После Сергей подтвердил визуально: разворот 4 правая = 5         │
# │   учеников + 1 hidden (Смирнов и Соколов в нижнем ряду слева),    │
# │   разворот 5 левая = combo с 2 учениками (Соловьёв + Варвара).     │
# │   ✓ Логически работает.                                            │
# │                                                                    │
# │ ─── Второй вопрос Сергея: «А можно ли их сделать по центру?» ───   │
# │                                                                    │
# │ После принятия РЭ.37.4.b Сергей заметил что видимые слоты         │
# │ остались на исходных координатах — Смирнов и Соколов в нижнем     │
# │ ряду оказались в позициях 1 и 2 (левых), а правая (3) пустая.     │
# │ Партнёр хотел центрирования.                                       │
# │                                                                    │
# │ Это та самая открытая задача placeholder_centering из spec §3.4    │
# │ которую я несколько раз откладывал.                                │
# │                                                                    │
# │ РЭ.37.5.b — feat: centerLastRowSlots (commit 1cdace3)              │
# │   Helper в sections/shared.ts. Применяется автоматически в         │
# │   bindGridStudents — работает для ВСЕХ grid и combo страниц без    │
# │   специальной логики на вызывающей стороне.                        │
# │                                                                    │
# │   Алгоритм:                                                        │
# │     1. Найти все studentportrait_N placeholder'ы.                  │
# │     2. Сгруппировать в строки по y_mm (tolerance 5 мм).            │
# │     3. Для каждой строки где есть __hidden__:                      │
# │        - Защита: hidden идут «с конца» (max(filled)<min(hidden))   │
# │        - Шаг dx = среднее расстояние между соседними слотами       │
# │        - Сдвиг shift = hidden_count_in_row * dx / 2                │
# │        - __pos__<label>='<new_x>,<y>' для каждого видимого         │
# │        - Связанные studentname_N + studentquote_N получают тот же  │
# │          shift по x                                                │
# │                                                                    │
# │   Renderer (Canvas/PDF) уже умеет парсить __pos__ через            │
# │   parseBalanceOverrides (lib/balance-overrides/index.ts) — никаких │
# │   изменений в Canvas/PDF не нужно.                                 │
# │                                                                    │
# │   +8 unit-тестов в center-last-row-slots.test.ts:                  │
# │     • 2×3 grid с 1 hidden → центрирование оставшихся               │
# │     • 2×3 grid с 2 hidden → 1 видимый на центр                     │
# │     • Связанные name/quote сдвигаются вместе с portrait             │
# │     • Полный ряд → no-op                                           │
# │     • Mixed pattern hidden → не центрируется (защита)              │
# │     • Combo-3: 2 видимых + classphoto → центрируется portrait-ряд  │
# │     • Edge cases (пустой мастер, один слот)                        │
# │                                                                    │
# │ ВИЗУАЛЬНАЯ ПРИЁМКА СЕРГЕЯ:                                         │
# │   Скриншоты разворотов 4 и 5 после деплоя:                         │
# │   • Разворот 4 правая (grid 6): Смирнов и Соколов в нижнем ряду    │
# │     ТЕПЕРЬ ПО ЦЕНТРУ (сдвинуты на полслота вправо). ✓              │
# │   • Разворот 5 левая (combo 3): Соловьёв и Варвара ТЕПЕРЬ В        │
# │     ЦЕНТРЕ верхнего ряда. ✓                                        │
# │   • Сергей: «Все супер, отлично сработало, мне нравится.»          │
# │                                                                    │
# │ Бонус: автоцентрирование сработало не только для симметризации,    │
# │ но и для любого адаптивного хвоста сетки. Если у партнёра          │
# │ 7 учеников Light → последняя страница имеет 1 ученика → раньше     │
# │ он торчал в углу, теперь по центру верхнего ряда.                  │
# │                                                                    │
# │ ПРОВЕРКИ:                                                          │
# │   • npx tsc → пусто                                                │
# │   • npx next build → зелёный                                       │
# │   • npx vitest run → 593/598 (baseline 583/588 + 10 новых:         │
# │     2 для РЭ.37.4.b + 8 для РЭ.37.5.b, те же 5 pre-existing fails) │
# │                                                                    │
# │ ИТОГ ДНЯ — массивный прогресс по фазе РЭ.37:                       │
# │   ✅ РЭ.37.1 (схема БД, поле symmetrize_students_tail)             │
# │   ✅ РЭ.37.2 (engine combo replacement + closing)                  │
# │   ✅ РЭ.37.3 (миграция БД стабов combo)                             │
# │   ✅ РЭ.37.3.b/c/b.1/b.2 (soft binding, complectation_unknown,     │
# │     sixth-first приоритет, понятные warnings)                      │
# │   ✅ РЭ.37.4 (engine симметризация)                                │
# │   ✅ РЭ.37.4.b (симметризация через preset для legacy)             │
# │   ✅ РЭ.37.5 (UI галочка)                                           │
# │   ✅ РЭ.37.5.b (автоцентрирование — placeholder_centering)         │
# │   ─────────────                                                    │
# │   ⏳ РЭ.37.6 (UI TransitionScenarioPicker — ручной custom)         │
# │   ⏳ РЭ.37.7 (большой регрессионный набор тестов)                  │
# │   ⏳ РЭ.37.8 (Сергей рисует combo-мастера в InDesign) — внешнее    │
# │                                                                    │
# │ И из побочного:                                                    │
# │   ✅ РЭ.38.1 (fallback chain для common_required)                  │
# │   ✅ РЭ.38.2 (clickable пустая страница в редакторе)               │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ — НА ОБСУЖДЕНИЕ С СЕРГЕЕМ                               │
# │ ────────────────────────────────────                               │
# │                                                                    │
# │   Вариант A — РЭ.37.7 (регрессионные тесты, M).                    │
# │     Зафиксировать текущее поведение прежде чем строить более       │
# │     сложные фичи. Полный набор кейсов из transition-section-spec   │
# │     xlsx (~30 сценариев) + edge cases mismatch + soft binding.     │
# │     Уровень рисков снижается перед РЭ.37.6.                        │
# │                                                                    │
# │   Вариант B — РЭ.37.6 (UI custom scenario, M).                     │
# │     Компонент TransitionScenarioPicker: radio «По умолчанию /      │
# │     Вручную». В custom-режиме партнёр выбирает мастера для         │
# │     tail_left, tail_right, closing вручную (вместо стандартной     │
# │     OkeyBook логики). Требует новое поле в БД для хранения custom  │
# │     scenario + расширение transition.ts.                           │
# │                                                                    │
# │   Вариант C — РЭ.37.8 (Сергей рисует InDesign-мастера).            │
# │     Внешняя работа Сергея, моего кода не требует. Когда правильные │
# │     J-Combined-Tail-3 / -4 / -2 мастера будут в template_set,      │
# │     legacy L-Combined-Page перестанет использоваться, warning      │
# │     transition_complectation_unknown сам собой исчезнет.           │
# │     Можно начинать прямо сейчас параллельно с моими задачами.      │
# │                                                                    │
# │   Вариант D — тестировать в реальной работе.                       │
# │     Прокатить несколько разных альбомов (5/13/25/30 учеников,      │
# │     разные комплектации) и собрать обратную связь прежде чем       │
# │     добавлять новые фичи.                                          │
# │                                                                    │
# │ Рекомендация: A → B → D. Сначала тесты как safety net, потом       │
# │ ручной custom, потом реальные альбомы. C идёт параллельно (это     │
# │ работа Сергея в InDesign).                                         │
# │                                                                    │
# │ ─── ИЗВЕСТНОЕ НЕЗАКРЫТОЕ (продолжаем игнорировать пока):           │
# │                                                                    │
# │   РЭ.37.3.d — вынос soft-чётности helpers в shared.ts + правки     │
# │     students.ts/common-required.ts. Касается зеркальных мастеров   │
# │     для soft binding. Для Light/Mini/Medium (Тест2) не             │
# │     проявляется. Делается по необходимости.                        │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V163 (25.05.2026)                                       │
# │                                                                    │
# │ РЭ.37.4 + РЭ.37.5 ЗАКРЫТЫ — СИММЕТРИЗАЦИЯ ХВОСТА (engine + UI)     │
# │                                                                    │
# │ Это та фаза которую Сергей просил приоритетом ещё до фиксов        │
# │ РЭ.37.3.b/c/d и РЭ.38. Теперь к ней вернулись.                     │
# │                                                                    │
# │ КОНЦЕПЦИЯ:                                                         │
# │   Без симметризации Light 13 даёт layout                           │
# │   [grid×6, grid×6] + [combo с 1 учеником + closing на R].          │
# │   Одинокий портрет на хвостовой странице визуально некрасив рядом  │
# │   с полной сеткой. Симметризация решает: 1 ученик с предыдущей     │
# │   страницы переезжает на хвостовую, теперь там 2+classphoto,       │
# │   на предыдущей 5+hidden. Опт-ин через preset.symmetrize_students_tail.│
# │                                                                    │
# │ ДВА КОММИТА:                                                       │
# │                                                                    │
# │   9ab7f0a — feat(РЭ.37.4) engine логика                            │
# │     Новая функция trySymmetrizeTail в transition.ts (≈170 строк).  │
# │     Применяется когда все условия выполнены:                       │
# │       1. preset.symmetrize_students_tail === true                  │
# │       2. complectation ∈ {'mini', 'light'}                         │
# │       3. layout.tail === 1                                         │
# │       4. layout.combo_master_base !== null                         │
# │       5. pageInstances.length ≥ 2                                  │
# │                                                                    │
# │     Алгоритм:                                                      │
# │       1. POP хвостовой + restore available.full_class              │
# │       2. POP предыдущей grid-страницы                              │
# │       3. Найти grid-master по previousPage.master_id (scan)        │
# │       4. Узнать gridSize (count studentportrait_N placeholders)    │
# │       5. Найти combo-мастер через findComboMaster() (sheet_type-aware)│
# │       6. PUSH previous с (gridSize-1) учениками — last slot hidden │
# │       7. PUSH combo с 2 учениками + classphoto — оставшиеся hidden │
# │       8. На любой ошибке (combo не найден, grid_master не найден,  │
# │          edge case): POP'ы откатываются, симметризация не применяется│
# │                                                                    │
# │     В fillOkeybookDefault вызывается ПЕРЕД tryReplaceTailWithCombo.│
# │     Если симметризация сработала — обычный combo replacement       │
# │     пропускается (combo уже положен). Closing через J-цепочку      │
# │     работает как обычно поверх симметризованного результата.       │
# │                                                                    │
# │     transition_symmetrized → 'info' в WARNING_LEVELS.              │
# │                                                                    │
# │     +5 тестов в sections-transition-combo:                         │
# │       • Light 13 + symmetrize=true → combo с 2 + prev grid с 5     │
# │         (главный тест — полные ожидания layout + bindings + hidden)│
# │       • Light 13 + symmetrize=false → контрольный (НЕ срабатывает) │
# │       • Light 14 tail=2 + symmetrize=true → НЕ срабатывает         │
# │       • Light 19 tail=1 нечёт-полные → combo на R с -Right         │
# │       • Standard + symmetrize=true → игнорируется (не Mini/Light)  │
# │                                                                    │
# │     pushGridPage в students.ts экспортирована (была private).      │
# │                                                                    │
# │   2ed2bc7 — feat(РЭ.37.5) UI галочка                               │
# │     В PresetEditorModal новая карточка в блоке grid-параметров:    │
# │       [☑ Симметризировать хвост]                                   │
# │       (только для 6 или 12 учеников на страницу)                   │
# │       'Если в хвосте остался один ученик, движок возьмёт ещё       │
# │        одного с предыдущей страницы — чтобы хвост был парным.'     │
# │                                                                    │
# │     Карточка имеет 2 состояния:                                    │
# │       • grid_size ∈ {6, 12} → голубой фон, активна, cursor-pointer │
# │       • остальные значения → серый фон, disabled, пояснение        │
# │                                                                    │
# │     В save body добавлено поле symmetrize_students_tail.           │
# │     API endpoint /api/tenant rule_preset_update уже принимал это   │
# │     поле с РЭ.37.1 — никаких backend правок не нужно.              │
# │                                                                    │
# │     В app/app/templates/[designId]/page.tsx handleEdit маппинг     │
# │     raw row → EditableP теперь включает symmetrize_students_tail   │
# │     (иначе TS error из-за required-ish поля в Preset type).        │
# │                                                                    │
# │ ОТКРЫТЫЙ ВОПРОС — placeholder_centering:                           │
# │   Spec §3.4 говорит что после перераспределения оба «дефицита»     │
# │   должны центрироваться через __pos__ ключи. В коммитах НЕ         │
# │   реализовано — только перераспределение + __hidden__. Реальное    │
# │   центрирование требует знать геометрию мастера и пересчитать      │
# │   координаты. Решение: либо РЭ.37.8 (Сергей нарисует мастера в     │
# │   InDesign сразу с правильным расположением слотов для типовых     │
# │   tail-cases — рекомендация spec §7), либо отдельная фаза          │
# │   автоцентрирования. Для рабочего поведения и так уже хорошо:      │
# │   ученики правильно распределены, лишние слоты скрыты.             │
# │                                                                    │
# │ ПРОВЕРКИ:                                                          │
# │   • npx tsc → пусто                                                │
# │   • npx next build → зелёный                                       │
# │   • npx vitest run → 583/588 (баselин 578/583 + 5 новых тестов     │
# │     симметризации, те же 5 pre-existing fails из v155)             │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ                                                         │
# │ ──────────                                                         │
# │   ШАГ ВНЕ КОДА (проверка симметризации на проде):                  │
# │     1. Открыть /super/presets, найти Light-пресет (grid_size=6).   │
# │     2. Открыть редактор → увидеть новую карточку 'Симметризировать │
# │        хвост' в блоке grid. Включить галку → сохранить.            │
# │     3. Создать тестовый альбом с 13/19/25 учениками (tail=1) с     │
# │        этим пресетом → проверить layout: на предпоследней странице │
# │        5 учеников + 1 hidden, на хвостовой combo с 2 + classphoto. │
# │     4. Без симметризации (галка снята) или для не-Light/Mini       │
# │        галка должна быть disabled.                                 │
# │                                                                    │
# │   РЭ.37.6 — UI компонент TransitionScenarioPicker (radio + custom- │
# │     конструктор для ручной настройки combo/closing). Размер M.     │
# │     Это позволит партнёру вручную задать «вместо стандартной       │
# │     OkeyBook логики использовать свою цепочку мастеров».           │
# │                                                                    │
# │   РЭ.37.7 — большой регрессионный набор тестов (все 30+ кейсов из  │
# │     xlsx + edge cases mismatch). Размер M.                         │
# │                                                                    │
# │   РЭ.37.8 — Сергей рисует combo-мастера в InDesign + приёмка.      │
# │     Внешнее. Закроет вопрос placeholder_centering.                 │
# │                                                                    │
# │ ─── ИЗВЕСТНОЕ НЕЗАКРЫТОЕ (продолжаем игнорировать пока):           │
# │                                                                    │
# │   РЭ.37.3.d — вынос soft-чётности helpers в shared.ts + правки     │
# │     students.ts/common-required.ts. Касается зеркальных мастеров   │
# │     для soft binding (E-Standard-Left vs -Right). Для Light/Mini/  │
# │     Medium (Тест2) не проявляется. Делается по необходимости.      │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V162 (25.05.2026)                                       │
# │                                                                    │
# │ РЭ.38 ЗАКРЫТ — ТРЁХСТУПЕНЧАТАЯ ОБРАБОТКА СТРАНИЦ ОБЩЕГО РАЗДЕЛА    │
# │                                                                    │
# │ КОНЦЕПЦИЯ (предложил Сергей 25.05.2026):                           │
# │   Раньше бинарная логика «положили мастер X / скипнули страницу».  │
# │   Стало градация:                                                  │
# │     • зелёный — положили X как хотели → 0 warnings                 │
# │     • жёлтый  — фоток для X не хватило → положили запасной Y из    │
# │                 соседней категории → info-warning «вместо X        │
# │                 поставлен Y»                                       │
# │     • красный — все варианты не подошли → страница пустая, можно   │
# │                 кликнуть и заменить шаблон вручную в редакторе     │
# │                                                                    │
# │ ДВА КОММИТА:                                                       │
# │                                                                    │
# │   9ed9052 — feat(РЭ.38.1) fallback chain для common_required       │
# │     В common-required.ts добавлен FALLBACK_CHAIN:                  │
# │       half_class → [J-Collage-6, J-Full]                           │
# │       sixth      → [J-Half, J-Full]                                │
# │       full_class → [J-Half, J-Collage-6]                           │
# │       quarter    → [J-Half, J-Collage-6, J-Full]                   │
# │     Когда haveCount < ability.count для запрошенного мастера —     │
# │     проходим по chain, ищем в template_set мастера по имени,       │
# │     проверяем capability и наличие фоток. Первый подошедший        │
# │     становится activeMaster, остальная логика (mirror, bindings,   │
# │     push) использует его. Info-warning с понятным объяснением:    │
# │     «вместо X поставлен Y, потому что не хватило фото».            │
# │                                                                    │
# │     spread категория не получает fallback (J-Spread занимает 2     │
# │     страницы, заменить одной нельзя — оставлен skip как раньше).   │
# │                                                                    │
# │     WARNING_LEVELS обновлён:                                       │
# │       • common_required_fallback_used → 'info' (новый код)         │
# │       • transition_complectation_unknown → 'info' (нормальный      │
# │         исход для legacy-шаблонов)                                 │
# │       • rule_engine_partial → 'info' (он generic-дубль факта       │
# │         «есть warnings», не должен сам быть тревожным)             │
# │       • rule_engine_warning → 'info'                               │
# │       • + добавлены все transition_* коды как degraded             │
# │         (combo_master_missing, custom_*, master_missing, etc).     │
# │                                                                    │
# │     +5 тестов в sections-common-required для fallback chain.       │
# │                                                                    │
# │   466e94a — feat(РЭ.38.2) clickable пустая страница в редакторе   │
# │     EmptyPagePlaceholder теперь принимает onClick? handler.        │
# │     Когда задан — компонент становится visual button:              │
# │       • синяя рамка вместо серой (border-blue-300)                 │
# │       • hover: bg-blue-50, border-blue-400                         │
# │       • cursor-pointer + role='button' + tabIndex=0                │
# │       • клавиатурная навигация Enter / Space                       │
# │       • текст «… — выберите шаблон» + tooltip                      │
# │                                                                    │
# │     Подключение в редакторе app/app/album/[id]/layout/page.tsx:    │
# │       • Левая пуста → onClick: setAddAfterIdx(rightIdx - 1)        │
# │         (handleAddSpread вставит новый SpreadInstance на rightIdx) │
# │       • Правая пуста → onClick: setAddAfterIdx(leftIdx)            │
# │         (handleAddSpread вставит на leftIdx+1)                     │
# │       • В обоих случаях открывается TemplatePickerModal через      │
# │         существующий addAfterIdx state — переиспользована вся      │
# │         механика handleAddSpread.                                  │
# │       • В read-only режиме (isReadOnly=true) onClick не передаётся │
# │         — компонент остаётся как был, просто placeholder.          │
# │                                                                    │
# │ ВИЗУАЛЬНАЯ ПРИЁМКА НА ТЕСТ2 (РЭ.38.1):                             │
# │   Плашка с warnings сменилась с тревожной оранжевой «Требует       │
# │   внимания (2)» на нейтрально-серую «К сведению (2)». В JSON       │
# │   warnings_by_level: { blocking: 0, degraded: 0, info: 2 }.        │
# │                                                                    │
# │ ПРОВЕРКИ:                                                          │
# │   • npx tsc → пусто                                                │
# │   • npx next build → зелёный                                       │
# │   • npx vitest run → 578/583 (баselин 573/578 + 5 новых fallback   │
# │     тестов, те же 5 pre-existing fails из v155).                   │
# │                                                                    │
# │ ИЗВЕСТНОЕ: РЭ.38.2 (UI) не имеет unit-тестов, проверяется только   │
# │ визуально на проде. Сценарий теста: создать пресет с common_required│
# │ требующим больше страниц чем доступно фото всех категорий, собрать │
# │ альбом, открыть редактор → кликнуть пустую сторону разворота →     │
# │ выбрать шаблон в TemplatePickerModal → он встанет на эту позицию.  │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ                                                         │
# │ ──────────                                                         │
# │   ШАГ ВНЕ КОДА: проверить РЭ.38.2 визуально (когда наткнёшься на   │
# │     ситуацию с пустой страницей). Сейчас Тест2 строится чисто без  │
# │     пустых страниц благодаря РЭ.38.1, так что специально создавай  │
# │     тестовый сценарий когда понадобится.                           │
# │                                                                    │
# │   РЭ.37.4 — симметризация хвоста (опт-ин). Это та фаза, которую    │
# │     Сергей просил приоритетом перед всеми правками выше. Теперь    │
# │     можно возвращаться к ней.                                      │
# │                                                                    │
# │   РЭ.37.5 — UI галочки симметризации в PresetEditorModal           │
# │                                                                    │
# │   РЭ.37.6 — UI TransitionScenarioPicker (radio + custom-конструктор│
# │     для ручной настройки combo/closing).                           │
# │                                                                    │
# │   РЭ.37.7 — большой регрессионный набор тестов.                    │
# │                                                                    │
# │   РЭ.37.8 — Сергей рисует combo-мастера в InDesign + приёмка.      │
# │                                                                    │
# │ ─── ИЗВЕСТНОЕ НЕЗАКРЫТОЕ (продолжаем игнорировать пока):           │
# │                                                                    │
# │   РЭ.37.3.d — вынос soft-чётности helpers в shared.ts + правки     │
# │     students.ts/common-required.ts. Касается зеркальных мастеров   │
# │     (E-Standard-Left vs -Right) для soft binding. Для Light/Mini/  │
# │     Medium (Тест2) не проявляется. Делается по необходимости.      │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V161 (25.05.2026)                                       │
# │                                                                    │
# │ РЭ.37.3.b.2 ЗАКРЫТ — sixth-first приоритет + понятные warnings    │
# │                                                                    │
# │ КАК ВЫЯВИЛОСЬ:                                                     │
# │   После РЭ.37.3.b/c/b.1 на проде Тест2 разворот 5 наконец-то       │
# │   закрылся через transition closing (J-Half на правой), но это     │
# │   создало побочный эффект: для последней страницы общего раздела   │
# │   (тоже J-Half) фоток half_class не хватило → она пропустилась с   │
# │   warning, в редакторе пустая правая страница без возможности      │
# │   залезть в неё руками.                                            │
# │                                                                    │
# │ РЕШЕНИЕ В ТРИ ШАГА (предложил Сергей):                             │
# │   (1) сейчас — снизить конкуренцию через smarter J-приоритет +     │
# │       понятные warnings для партнёра. ← ЭТО Я ДЕЛАЮ                │
# │   (2) РЭ.38.1 — fallback chain для common_required (вместо skip —  │
# │       подобрать запасной мастер из похожей категории + warning     │
# │       вида "вместо X поставлен Y").                                │
# │   (3) РЭ.38.2 — clickable пустая страница в редакторе              │
# │       (последняя страховка: партнёр заменяет мастер руками).       │
# │                                                                    │
# │ ЧТО ИЗМЕНЕНО (РЭ.37.3.b.2 — commit 475de29):                       │
# │                                                                    │
# │   • J_PRIORITY_OKEYBOOK_DEFAULT в transition.ts:                   │
# │     было  [half_class, sixth, full_class]                          │
# │     стало [sixth, half_class, full_class]                          │
# │                                                                    │
# │   Логика: партнёры обычно загружают много sixth-фоток (под         │
# │   коллажи), а half_class и full_class единицы. sixth — наименее    │
# │   дефицитная категория, ей не жалко закрывать transition closing.  │
# │                                                                    │
# │   • Все 3 проблемных warning переписаны на язык партнёра:          │
# │       - common_required_page_skipped → указывает номер страницы,   │
# │         русское название категории, сколько докинуть, и куда       │
# │         дальше идти ("Загрузите ещё N или замените шаблон вручную").│
# │       - transition_skipped → показывает доступность всех 3         │
# │         категорий + что делать.                                    │
# │       - transition_complectation_unknown → уточнено что это        │
# │         нормально для legacy-шаблонов.                             │
# │                                                                    │
# │   • Добавлен helper humanPhotoCategory() в sections/shared.ts:     │
# │     full_class / half_class / sixth / quarter / spread на русские  │
# │     названия из UI загрузки фото.                                  │
# │                                                                    │
# │ ЭФФЕКТ НА ТЕСТ2 ПОСЛЕ ДЕПЛОЯ:                                      │
# │   • разворот 5: combo на L + J-Collage-6 на R (вместо J-Half).     │
# │     У Сергея минимум 8 фото sixth → пройдёт чисто.                 │
# │   • общий раздел строится полностью, half_class остаётся для       │
# │     последней J-Half страницы.                                     │
# │   • warnings должны исчезнуть.                                     │
# │                                                                    │
# │ ПРОВЕРКИ:                                                          │
# │   • npx tsc → пусто                                                │
# │   • npx next build → зелёный                                       │
# │   • npx vitest run → 573/578 (те же 5 pre-existing, без регрессий) │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ (СОГЛАСОВАНО С СЕРГЕЕМ)                                 │
# │ ─────────────────────────────────                                  │
# │   ШАГ ВНЕ КОДА: проверить Тест2 после деплоя — должен пройти       │
# │     полностью чисто без warnings и без пустых страниц.             │
# │                                                                    │
# │   РЭ.37.4 — симметризация хвоста (опт-ин). Будет после визуальной  │
# │     приёмки Тест2.                                                 │
# │                                                                    │
# │   РЭ.37.5 — UI галочки симметризации в PresetEditorModal.          │
# │                                                                    │
# │   РЭ.37.6 — UI TransitionScenarioPicker (radio + custom-конструктор│
# │     для ручной настройки combo/closing).                           │
# │                                                                    │
# │   РЭ.37.7 — большой регрессионный набор тестов.                    │
# │                                                                    │
# │   РЭ.37.8 — Сергей рисует combo-мастера в InDesign + приёмка.      │
# │                                                                    │
# │ ─── НОВАЯ ВЕТКА: РЭ.38 (после визуальной приёмки 37.3.b.2)         │
# │                                                                    │
# │   РЭ.38.1 — fallback chain для common_required.                    │
# │     Сейчас бинарная логика: положили мастер X / скипнули страницу. │
# │     Хочется градацию:                                              │
# │       • zelёный  — положили X как хотели → warning не нужен        │
# │       • жёлтый   — для X фоток не хватило, положили запасной Y     │
# │                    (из похожей категории) → info-warning вида      │
# │                    "вместо X поставлен Y, потому что фоток типа Z  │
# │                    загружено M из N необходимых"                   │
# │       • красный  — все запасные тоже не подошли → страница пустая  │
# │                    + явный warning + ссылка на ручную замену       │
# │     Объём 2-3 часа, требует осторожности — fallback-категории      │
# │     нужно проектировать (sixth не заменит full, и т.п.).           │
# │                                                                    │
# │   РЭ.38.2 — clickable пустая страница в редакторе.                 │
# │     UI работа: разрешить клик и кнопку "Заменить шаблон" на        │
# │     пустой правой/левой стороне. Партнёр выбирает любой подходящий │
# │     мастер вручную. Последняя страховка для красного сценария.     │
# │                                                                    │
# │ ─── ИЗВЕСТНОЕ НЕЗАКРЫТОЕ (продолжаем игнорировать пока):           │
# │                                                                    │
# │   РЭ.37.3.d — вынос soft-чётности helpers в shared.ts + правки     │
# │     students.ts/common-required.ts. Касается зеркальных мастеров   │
# │     (E-Standard-Left vs -Right) для soft binding. Для Light/Mini/  │
# │     Medium (Тест2) не проявляется. Делается по необходимости.      │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V160 (25.05.2026)                                       │
# │                                                                    │
# │ ФАЗЫ РЭ.37.3.b + РЭ.37.3.c ЗАКРЫТЫ — ЧЁТНОСТЬ ДЛЯ SOFT BINDING    │
# │                                                                    │
# │ КАК ВЫЯВИЛОСЬ:                                                     │
# │   После применения миграции РЭ.37.3 Сергей собрал Тест2 (Light,    │
# │   soft binding, 25 учеников). Combo сработал — на левой развороту  │
# │   5 встала combo-страница с 1 портретом + classphoto. Но:          │
# │   1) правая страница развороту 5 осталась пустой;                  │
# │   2) UI «Обзор» показывал смещённую группировку, в Редакторе       │
# │      картинка отличалась.                                          │
# │                                                                    │
# │ КОРНЕВАЯ ПРИЧИНА:                                                  │
# │   Engine использовал формулу pageInstances.length % 2 для          │
# │   определения «висит ли правая» и position L/R. Эта формула        │
# │   правильна только для layflat — у layflat pageInstances[0] это    │
# │   physical page 1 = LEFT первого разворота. У soft binding page 1  │
# │   физически отсутствует (это обложка/forzac), pageInstances[0] —   │
# │   это physical page 2 = RIGHT первого разворота.                   │
# │                                                                    │
# │   Из-за этого все места с pageInstances.length % 2 для soft        │
# │   работали со СДВИГОМ НА 1 относительно физической чётности.       │
# │                                                                    │
# │ ДВА КОММИТА:                                                       │
# │                                                                    │
# │   e2d0f94 — fix(РЭ.37.3.b) чётность transition.ts                  │
# │     Добавлены три helper-функции:                                  │
# │       • softOffset(ctx) → 0 для hard, 1 для soft                   │
# │       • positionOfIndex(ctx, index) → 'left'/'right' по physical   │
# │       • hasVacantRight(ctx) → true если последняя на LEFT          │
# │     Заменено 5 мест с pageInstances.length % 2:                    │
# │       • fillOkeybookDefault — complectation_unknown warning        │
# │       • fillOkeybookDefault — нужен ли closing после combo         │
# │       • tryReplaceTailWithCombo — position для combo               │
# │       • tryJChainClosing — position для closing                    │
# │       • fillLegacyMasterName — skip когда нет висящей правой       │
# │     Custom mode (РЭ.37.2.c) НЕ затронут — там layout.full_pages,   │
# │     не pageInstances.length.                                       │
# │     Добавлено 4 новых теста в sections-transition-combo для soft   │
# │     binding через decision_trace (13/6/12/19 учеников).            │
# │                                                                    │
# │   d5f11cf — fix(РЭ.37.3.c) группировка spreads для soft            │
# │     В build-from-section-structure.ts цикле group→SpreadInstance   │
# │     добавлен soft-aware первый шаг:                                │
# │       if (sheet_type==='soft' && len>0 && !pi[0].section_start) {  │
# │         spreads.push({ right: pi[0] });                            │
# │         i = 1;                                                     │
# │       }                                                            │
# │     Исключение section_start важно: если первой секцией стоит      │
# │     common_required или soft_final (выставляющие section_start),   │
# │     страница остаётся на LEFT.                                     │
# │     Обновлено 9 существующих тестов с правильными soft-ожиданиями. │
# │                                                                    │
# │ ЭФФЕКТ НА ПРОДЕ ПОСЛЕ ДЕПЛОЯ:                                      │
# │   Сергей делает pull + Vercel автоматически передеплоит. После     │
# │   ре-сборки Тест2:                                                 │
# │     • combo на левой остаётся (та же позиция, та же база);         │
# │     • на правой разворота 5 теперь положится J-Half с 2 фото       │
# │       half_class из пула;                                          │
# │     • Обзор покажет правильную физическую раскладку (как Редактор).│
# │                                                                    │
# │ ИЗВЕСТНОЕ НЕЗАКРЫТОЕ (РЭ.37.3.d, future):                          │
# │   sections/students.ts и sections/common-required.ts тоже          │
# │   используют pageInstances.length % 2 для зеркальных мастеров      │
# │   (E-Standard-Left vs -Right) и для логики section_start.          │
# │   После моего фикса группировки эти места работают в layflat-      │
# │   логике, но физическая раскладка для soft теперь другая. Для      │
# │   Light/Mini/Medium (сеточные, без зеркал) это не критично —       │
# │   всё работает. Для Standard/Universal на soft — мастера могут     │
# │   оказаться на противоположных от ожидаемых сторонах. Layout       │
# │   технически работает (страницы есть), но семантика искажена.      │
# │                                                                    │
# │   РЭ.37.3.d — вынести softOffset/positionOfIndex/hasVacantRight    │
# │   из transition.ts в shared.ts и подключить к students.ts и        │
# │   common-required.ts. Объём: ~M (правки + правки нескольких        │
# │   тестов). Делается ПО НЕОБХОДИМОСТИ: пока используется только     │
# │   Light в Тест2, проблема не наблюдается. Если партнёры начнут     │
# │   делать Standard/Universal альбомы на soft binding — приоритет    │
# │   повысится.                                                       │
# │                                                                    │
# │ ПРОВЕРКИ ПОСЛЕ ВСЕЙ ФАЗЫ:                                          │
# │   • npx tsc --noEmit → пусто                                       │
# │   • npx next build → зелёный                                       │
# │   • npx vitest run → 572/577                                       │
# │     baseline до сессии: 568/573                                    │
# │     +4 новых soft теста (РЭ.37.3.b)                                │
# │     5 fails те же pre-existing из v155 (sections-students grid     │
# │     fallbacks 3 шт + common_additional Universal hard 1 шт +       │
# │     ещё один). Не связаны с РЭ.37.                                 │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ                                                         │
# │ ──────────                                                         │
# │   ШАГ ВНЕ КОДА: проверить Тест2 после деплоя — combo + closing на  │
# │     развороте 5 должны быть оба, Обзор и Редактор согласованы.     │
# │                                                                    │
# │   РЭ.37.4 — симметризация хвоста (опт-ин флаг                      │
# │     symmetrize_students_tail из РЭ.37.1). Только Mini/Light, только│
# │     при хвосте 1: забираем 1 ученика с предыдущей страницы.        │
# │     Сергей подтвердил приоритет: после визуальной приёмки c, b.    │
# │   РЭ.37.5 — UI галочки симметризации в PresetEditorModal           │
# │   РЭ.37.6 — UI компонент TransitionScenarioPicker (radio + custom).│
# │     Здесь партнёр сможет настроить closing-мастер вручную (как     │
# │     просил Сергей: «у меня будут возможности самостоятельно        │
# │     настроить то, что там будет»).                                 │
# │   РЭ.37.7 — большой регрессионный набор тестов                     │
# │   РЭ.37.8 — Сергей рисует combo-мастера в InDesign + приёмка       │
# │                                                                    │
# │   РЭ.37.3.d (опционально, по необходимости) — вынос helper'ов      │
# │     soft-чётности в shared.ts + правки students/common-required.   │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V159 (24.05.2026, день)                                 │
# │                                                                    │
# │ ФАЗА РЭ.37.3 ЗАКРЫТА — СТАБЫ COMBO-МАСТЕРОВ В БД                   │
# │                                                                    │
# │ ОДИН КОММИТ:                                                       │
# │                                                                    │
# │   f2f522e — feat(РЭ.37.3): миграция БД — стабы 6 combo-мастеров   │
# │     migrations/2026-05-24-spread-templates-combo-tail-stubs.sql    │
# │                                                                    │
# │     DO $$-блок plpgsql вставляет ровно 6 записей в spread_templates│
# │     под template_set 'okeybook-default' (tenant_id=NULL):          │
# │                                                                    │
# │       J-Combined-Tail-4         — Mini, L, M=4                     │
# │       J-Combined-Tail-4-Right   — Mini, R, M=4                     │
# │       J-Combined-Tail-3         — Light, L, M=3                    │
# │       J-Combined-Tail-3-Right   — Light, R, M=3                    │
# │       J-Combined-Tail-2         — Medium, L, M=2                   │
# │       J-Combined-Tail-2-Right   — Medium, R, M=2                   │
# │                                                                    │
# │     ПОЛЯ КАЖДОЙ ЗАПИСИ:                                            │
# │       • placeholders — studentportrait_1..M (photo) +              │
# │         studentname_1..M (text, Arial/12pt/center) +               │
# │         classphotoframe (photo, широкая полоса снизу).             │
# │         Координаты — разумная сетка под page ≈200×280 mm.          │
# │       • slot_capacity = { "students": M, "photos_full": 1 }        │
# │       • type='common', page_role='common', is_spread=false         │
# │       • applies_to_configs = '{}', default_for_configs = '{}'      │
# │         (combo выбирается ТОЛЬКО через findComboMaster по имени;   │
# │         в семантический findMaster им попадать не надо — иначе     │
# │         конкуренция с J-Full на closing-странице)                  │
# │       • family_id=NULL, page_type='page-any', density=NULL,        │
# │         params='{}'::jsonb, background_url=NULL                    │
# │       • is_fallback=false, mirror_for_soft=false                   │
# │       • audit_notes = 'РЭ.37.3 STUB: structural record, real       │
# │                       InDesign geometry comes in РЭ.37.8'          │
# │       • display_label = 'Combo-N хвост (Имя_комплектации, L/R...)' │
# │                                                                    │
# │ ИДЕМПОТЕНТНОСТЬ:                                                   │
# │   Каждый INSERT защищён WHERE NOT EXISTS по (template_set_id,name).│
# │   Повторное применение → 0 строк затронуто, RAISE NOTICE по каждой │
# │   записи (inserted / skipped).                                     │
# │                                                                    │
# │ ВАЖНО ПРО R-ВЕРСИИ:                                                │
# │   В стабе координаты у -Right совпадают с базовыми (не зеркало).   │
# │   Это не дефект, а признак стаба. В РЭ.37.8 R-версии станут        │
# │   настоящими зеркалами (classphoto у внешнего края разворота).     │
# │                                                                    │
# │ ПРИМЕНЕНИЕ В ПРОДЕ:                                                │
# │   Миграция написана, НО на проде ещё НЕ применена. Сергей          │
# │   запускает её в Supabase SQL Editor (он же применил РЭ.37.1).     │
# │   До применения движок продолжает выдавать                         │
# │   transition_combo_master_missing — это известный fallback, прод   │
# │   не падает.                                                       │
# │                                                                    │
# │ ПРОВЕРКИ ПЕРЕД ПУШЕМ:                                              │
# │   • npx tsc --noEmit → пусто                                       │
# │   • npx next build → зелёный                                       │
# │   • npx vitest run → 568/573 (ровно baseline v158, регрессий нет)  │
# │                                                                    │
# │ ПОЧЕМУ ТЕСТЫ НЕ ПОТРОГАНЫ:                                         │
# │   Все 30 тестов sections-transition-combo используют свои          │
# │   фикстуры combo-мастеров через makeMaster() в памяти, поэтому     │
# │   реальная БД на них не влияет. Соответственно в этой фазе         │
# │   тесты НЕ переписываем — БД-стабы и in-memory фикстуры живут     │
# │   параллельно.                                                     │
# │                                                                    │
# │ ОБСУЖДЁННЫЕ ДЕФОЛТЫ (зафиксировано перед кодом):                   │
# │   1. SQL-миграция (не direct insert, не /super/master-catalog).    │
# │      master-catalog умеет только просмотр + display_label, кнопки  │
# │      «создать» там нет — поэтому миграция.                         │
# │   2. template_set = okeybook-default, tenant_id=NULL.              │
# │   3. Geometry placeholder'ов — разумная сетка (b-вариант), не      │
# │      «всё в 0,0» и не реальные размеры (их пока нет).              │
# │   4. studentname_1..M ДОБАВЛЕНЫ как text-слоты. studentquote НЕ    │
# │      добавлены — если в дизайне понадобятся, апдейт в РЭ.37.8.    │
# │   5. slot_capacity использует ключ 'photos_full' (соответствует    │
# │      типу SlotCapacity), а не 'classphotoframe' из спеки. label   │
# │      'classphotoframe' живёт только в placeholders.                │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ (по состоянию v159, ПЕРЕЗАПИСАНО в v160)                │
# │ ──────────                                                         │
# │   ШАГ ВНЕ КОДА: Сергею применить миграцию в Supabase SQL Editor    │
# │     и проверить SELECT в конце файла (6 строк, имена/capacity      │
# │     совпадают). После этого можно прогнать сборку Тест2 с          │
# │     хвостом 1..M ученика — combo подхватится.                      │
# │     ✅ ПРИМЕНЕНО (миграция, SELECT=6 строк).                       │
# │     ⚠️ ВЫЯВЛЕНА ПРОБЛЕМА: правая разворота 5 в Тест2 осталась      │
# │     пустой. Причина — чётность pageInstances не учитывает soft     │
# │     binding. → РЭ.37.3.b + РЭ.37.3.c в v160.                       │
# │                                                                    │
# │   РЭ.37.4 — симметризация хвоста (опт-ин флаг                      │
# │     symmetrize_students_tail из РЭ.37.1). Только Mini/Light, только│
# │     при хвосте 1: забираем 1 ученика с предыдущей страницы,        │
# │     обе страницы центрируются placeholder_centering.               │
# │   РЭ.37.5 — UI галочки симметризации в PresetEditorModal           │
# │   РЭ.37.6 — UI компонент TransitionScenarioPicker (radio + custom) │
# │   РЭ.37.7 — большой регрессионный набор тестов                     │
# │   РЭ.37.8 — Сергей рисует combo-мастера в InDesign + приёмка       │
# │     (тогда же обновляются placeholders созданных стабов)           │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V158 (25.05.2026)                                       │
# │                                                                    │
# │ ФАЗА РЭ.37.2 ЗАКРЫТА — ENGINE ПЕРЕХОДНОГО РАЗДЕЛА                  │
# │                                                                    │
# │ ТРИ ПОДКОММИТА В ОДНОЙ СЕССИИ:                                     │
# │                                                                    │
# │   d7102f7 — feat(РЭ.37.2.a) classifyTransitionLayout               │
# │     (см. v157, чистый классификатор)                               │
# │                                                                    │
# │   c3cd9bb — feat(РЭ.37.2.b) engine с combo-заменой хвоста          │
# │     • Переписан lib/rule-engine/sections/transition.ts             │
# │     • Новый lib/rule-engine/detect-complectation.ts                │
# │     • students.ts: pushCombinedTailPage сделан экспортным          │
# │       (поведение не тронуто — только видимость)                    │
# │     • build-from-section-structure.ts: передаём всю секцию вместо  │
# │       одного master_name                                           │
# │     • Реализован «Вариант 1»: students кладёт хвост как обычно,    │
# │       transition при необходимости делает POP + PUSH combo         │
# │     • Новый порядок J-цепочки: half_class → sixth → full_class     │
# │       (без quarter — он только в common_required)                  │
# │     • Зеркальные combo: ищем -Right для R, fallback на base        │
# │     • Legacy master_name ветка сохранена для обратной совместимости│
# │     • 24 интеграционных теста (Light combo / detect-complectation /│
# │       J-цепочка / okeybook vs legacy)                              │
# │                                                                    │
# │   3aa6fb7 — feat(РЭ.37.2.c) mode='custom' реализация               │
# │     • Партнёр через TransitionCustomScenario явно задаёт мастера   │
# │       для двух кейсов: tail_left (combo+J) и tail_right (combo)    │
# │     • Engine выбирает сценарий по чётности full_pages              │
# │     • applyCustomTailLeft / applyCustomTailRight с rollback при    │
# │       отсутствии мастера в template_set                            │
# │     • Не combo случаи (grid_padded, tail=0+full нечёт) — fallback  │
# │       на okeybook_default. Это совпадает с UI спекой РЭ.37.6,      │
# │       где партнёр настраивает только combo                         │
# │     • +6 тестов, +1 переписан (был на not_implemented stub)        │
# │                                                                    │
# │ КЛЮЧЕВЫЕ ВЕТКИ В transition.ts                                     │
# │ ──────────────────────────────                                     │
# │   fillTransitionSection(ctx, sectionEntry):                        │
# │     if mode === 'custom'    → fillCustomMode                       │
# │     elif master_name задан  → fillLegacyMasterName (РЭ.32)        │
# │     else                    → fillOkeybookDefault                  │
# │                                                                    │
# │ ПРОВЕРКИ (СВОДКА ПО ВСЕЙ ФАЗЕ)                                     │
# │ ──────────────────────────────                                     │
# │   • npx tsc --noEmit → пусто                                       │
# │   • npx vitest run (вся suite) → 568/573                           │
# │     - 489 было до фазы РЭ.37                                       │
# │     - +49 РЭ.37.2.a (transition-cases классификатор)               │
# │     - +24 РЭ.37.2.b (combo / detect / J-приоритет)                 │
# │     - +6 РЭ.37.2.c (custom)                                        │
# │     - 5 fails — pre-existing из v155 (sections-students grid       │
# │       fallbacks, common_additional Universal hard). Не имеют       │
# │       отношения к РЭ.37.                                           │
# │   • npx next build → зелёный                                       │
# │   • Существующие 8 тестов sections-transition.test.ts (Standard,   │
# │     legacy РЭ.32) прошли без изменений — обратная совместимость   │
# │     сохранена.                                                     │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ (по состоянию V158, до РЭ.37.3)                         │
# │ ──────────                                                         │
# │   РЭ.37.3 — стабы combo-мастеров в БД (J-Combined-Tail-4 / -3 / -2 │
# │     + -Right варианты для всех). Это структурные записи в          │
# │     spread_templates с placeholders, без InDesign-арта. Engine     │
# │     уже их ищет; нужно их создать в окружении.                     │
# │     ✅ ЗАКРЫТО в v159 (коммит f2f522e)                             │
# │   РЭ.37.4 — симметризация хвоста (опт-ин флаг                      │
# │     symmetrize_students_tail из РЭ.37.1). Только Mini/Light, только│
# │     при хвосте 1: забираем 1 ученика с предыдущей страницы,        │
# │     обе страницы центрируются placeholder_centering.               │
# │   РЭ.37.5 — UI галочки симметризации в PresetEditorModal           │
# │   РЭ.37.6 — UI компонент TransitionScenarioPicker (radio + custom) │
# │   РЭ.37.7 — большой регрессионный набор тестов                     │
# │   РЭ.37.8 — Сергей рисует combo-мастера в InDesign + приёмка       │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V157 (24.05.2026 ПОЗДНЯЯ НОЧЬ)                          │
# │                                                                    │
# │ ЗАКРЫТ РЭ.37.2.a — ЧИСТЫЙ КЛАССИФИКАТОР ПЕРЕХОДНОГО РАЗДЕЛА        │
# │                                                                    │
# │ В НАЧАЛЕ ЧАТА — УТОЧНЕНЫ КЛЮЧЕВЫЕ КОНВЕНЦИИ:                       │
# │                                                                    │
# │   • Чётность страниц OkeyBook: левые = нечётные (1, 3, 5, ...),    │
# │     правые = чётные (2, 4, 6, ...). И для плотных, и для мягких    │
# │     листов одинаково. У мягких страница "1" физически отсутствует  │
# │     (открывает page 2 как правую).                                 │
# │                                                                    │
# │   • Combo-мастера всегда асимметричные: для каждого Combo-N в      │
# │     InDesign будет два файла — J-Combined-Tail-N (для левой) и     │
# │     J-Combined-Tail-N-Right (для правой). Движок найдёт -Right     │
# │     по конвенции имени.                                            │
# │                                                                    │
# │   • НОВАЯ ЛОГИКА vs xlsx: историческая таблица "до 24/12 = off"    │
# │     была под ручной труд дизайнера. Для автоматики переходный      │
# │     раздел нужен даже при малом количестве учеников.               │
# │                                                                    │
# │   • J-цепочка для closing: half_class → sixth → full_class по      │
# │     ДОСТУПНОСТИ фото в пуле (не жёсткий приоритет). Если в пуле    │
# │     нет 2 половинок — берём то, что есть.                          │
# │                                                                    │
# │ КОММИТ:                                                            │
# │                                                                    │
# │   d7102f7 — feat(РЭ.37.2.a)                                        │
# │     lib/rule-engine/transition-cases.ts (новый файл):              │
# │       • type Complectation = 'mini' | 'light' | 'medium' |         │
# │         'standard' | 'universal' | 'maximum'                       │
# │       • type TailPageKind = 'none' | 'combo' | 'grid_padded'       │
# │       • type ClosingPageKind = 'none' | 'j_chain'                  │
# │       • interface TransitionLayout (full_pages, tail, tail_page,   │
# │         combo_master_base, combo_capacity, closing_page)           │
# │       • function classifyTransitionLayout(complectation, count)    │
# │         — pure function без побочных эффектов, не привязана к      │
# │         pageInstances. Возвращает "логический результат": что      │
# │         должно лежать на хвостовой странице (combo / N-Grid +      │
# │         padding / ничего) и нужна ли закрывающая через J-цепочку.  │
# │                                                                    │
# │     lib/rule-engine/__tests__/transition-cases.test.ts (49 тестов):│
# │       • Mini: 0, 1, 4, 5, 11, 12, 24, 25, 28, 29, 36, 48           │
# │       • Light: 6, 12, 13, 15, 16, 18, 19, 21                       │
# │       • Medium: 8, 9, 11, 13                                       │
# │       • Standard: 0, 22, 23 / Universal: 20, 21                    │
# │       • Maximum: всегда off                                        │
# │       • Невалидный ввод                                            │
# │       • Инварианты на n=0..50 для всех комплектаций                │
# │                                                                    │
# │ ПРОВЕРКИ:                                                          │
# │   • npx tsc --noEmit --project . → пусто                           │
# │   • npx vitest run transition-cases → 49/49                        │
# │   • npx vitest run (вся suite) → 538/543; 5 fails те же из v155    │
# │   • npx next build → зелёный                                       │
# │                                                                    │
# │ ЧТО НЕ ВОШЛО В РЭ.37.2.a (придёт в b/c):                           │
# │   • Изменения в lib/rule-engine/sections/transition.ts             │
# │   • Определение комплектации из мастеров students                  │
# │   • Custom-режим (mode='custom')                                   │
# │   • Привязка к L/R по чётности pageInstances                       │
# │   • Реализация J-цепочки с выбором по доступности фото             │
# │                                                                    │
# │ ОТКРЫТЫЙ ВОПРОС НА РЭ.37.2.b:                                      │
# │   Сейчас sections/students.ts ВСЕГДА кладёт хвостовую страницу     │
# │   (даже неполную). Combo-режим требует ЛИБО заменить эту хвостовую │
# │   страницу на combo (pop + push), ЛИБО students пропускает её      │
# │   и оставляет transition положить combo. Решение принимаем в b     │
# │   (вероятно — pop+push для минимизации изменений в students.ts).   │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V156 (24.05.2026 НОЧЬ)                                  │
# │                                                                    │
# │ ЗАКРЫТ РЭ.37.1 — ТИПЫ И МИГРАЦИЯ БД ДЛЯ ПЕРЕХОДНОГО РАЗДЕЛА:       │
# │                                                                    │
# │ В НАЧАЛЕ ЧАТА — ЗАФИКСИРОВАНЫ РЕШЕНИЯ ПО РИСКУ MISMATCH:           │
# │                                                                    │
# │   A1 (один transition на шаблон): секция transition остаётся       │
# │     ровно одной записью в section_structure, последней перед       │
# │     common_required. Закрывает хвост последней students-секции.    │
# │     Внутренние хвосты предыдущих students-секций (например,        │
# │     N-Grid-12 с 11/12 учеников) лечатся placeholder_centering      │
# │     ВНУТРИ той же секции, без отдельного combo-мастера.            │
# │                                                                    │
# │   Б1 (комплектация по последней students): combo-мастер для        │
# │     transition выбирается по комплектации той students-секции,    │
# │     чей хвост закрываем (по умолчанию — последняя перед            │
# │     common_required). Спека §3.1 «по наличию сетки» теперь         │
# │     читается как «по мастеру конкретной students-секции».          │
# │                                                                    │
# │   В1 (одно classphoto на альбом): combo-мастер использует общее    │
# │     classphoto из пула фото. Тегирование «школьное / детсадовское  │
# │     classphoto» — отдельная большая тема (тегирование пула фото),  │
# │     не для РЭ.37. Если потребуется — РЭ.39+.                       │
# │                                                                    │
# │ ВАЖНАЯ ПОПРАВКА К СПЕКЕ:                                           │
# │   В докуменях v155 и transition-section-spec.md упоминается        │
# │   таблица config_presets — это слип. Реальная таблица для нового   │
# │   движка — `presets`. config_presets — legacy для старого движка,  │
# │   её НЕ трогаем. Миграция РЭ.37.1 применена в `presets`.           │
# │                                                                    │
# │ КОММИТЫ:                                                           │
# │                                                                    │
# │   ee4d056 — feat(РЭ.37.1): миграция БД                             │
# │     migrations/2026-05-24-presets-symmetrize-students-tail.sql     │
# │     ALTER TABLE presets ADD COLUMN symmetrize_students_tail        │
# │       BOOLEAN NOT NULL DEFAULT FALSE.                              │
# │     Применена в Supabase, 13 пресетов получили false.              │
# │                                                                    │
# │   0f60bb7 — feat(РЭ.37.1): типы + loaders + API валидация          │
# │     lib/rule-engine/types.ts:                                      │
# │       • Новый interface TransitionCustomScenario с tail_left/right │
# │       • SectionStructureEntry для type='transition' теперь имеет   │
# │         3 формы: (a) legacy master_name (РЭ.32),                   │
# │         (b) mode='okeybook_default' (РЭ.37),                       │
# │         (c) mode='custom' + custom (РЭ.37). Master_name и mode     │
# │         одновременно запрещены — валидатор API отвергает.          │
# │       • Preset.symmetrize_students_tail?: boolean | null           │
# │     lib/rule-engine/loaders.ts:                                    │
# │       • presetRowToPreset читает поле, safe-fallback на false.     │
# │     app/api/tenant/route.ts:                                       │
# │       • ValidatedSection union расширен 3 формами transition.      │
# │       • validateSectionStructure обрабатывает все 3 формы.         │
# │       • Хелперы validateTransitionCustom, validateTransition       │
# │         MasterRef — валидация структуры custom-сценария.           │
# │       • SELECT в rule_presets_list дополнен новым полем.           │
# │       • Patch в rule_preset_update принимает boolean.              │
# │                                                                    │
# │ ПРОВЕРКИ ПЕРЕД ПУШЕМ (КАК В ПРАВИЛАХ):                             │
# │   • npx tsc --noEmit --project . → пусто                           │
# │   • npx next build → зелёный                                       │
# │   • vitest run → 489/494, 5 fails те же что в v155                 │
# │     (pre-existing «легаси РЭ.22 семантика плотностей»).            │
# │                                                                    │
# │ СОВМЕСТИМОСТЬ:                                                     │
# │   • UI PresetEditorModal.tsx ещё пишет в legacy форму              │
# │     transition.master_name (через TransitionMasterSelector). Это   │
# │     валидно по новому валидатору — форма (a) поддерживается.       │
# │     Перепишется в РЭ.37.6 на radio + custom-конструктор.           │
# │   • Старые сохранённые пресеты (с transition.master_name или       │
# │     совсем без поля) продолжают работать как раньше.               │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ (РЭ.37.2):                                              │
# │   1. Engine: новая функция fillTransitionSection с поддержкой      │
# │      обоих режимов (okeybook_default / custom) + таблица правил    │
# │      OkeyBook как данные.                                          │
# │   2. Перенос таблицы из transition-section-spec.xlsx в TS-данные   │
# │      (5 комплектаций × 2 типа листов × диапазоны учеников).        │
# │   3. Покрытие тестами edge cases из xlsx.                          │
# │   Размер: L (большой подэтап, отдельная сессия).                   │
# │                                                                    │
# │ ОТКРЫТЫЕ РИСКИ К РЕШЕНИЮ ПО ХОДУ (без изменений с v155):           │
# │   • Автоматическое центрирование внутри combo-N — РЭ.37.4          │
# │   • Фильтр dropdown'а custom-режима по фактическому slot_capacity  │
# │     template_set — РЭ.37.6                                         │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V155 (24.05.2026 ВЕЧЕР)                                 │
# │                                                                    │
# │ РЭ.37 — ЗАФИКСИРОВАНА СПЕЦИФИКАЦИЯ ПЕРЕХОДНОГО РАЗДЕЛА:            │
# │                                                                    │
# │ ВАЖНО: код в РЭ.37 НЕ начат. Эта версия — точка передачи в новый   │
# │ чат под РЭ.37. Спека готова, требования с Сергеем закрыты, можно   │
# │ начинать реализацию РЭ.37.1.                                       │
# │                                                                    │
# │ ДОБАВЛЕНО В РЕПО:                                                  │
# │   • docs/transition-section-spec.xlsx (0dd8f0d) — таблица правил   │
# │     от Сергея, изначально написана для скрипта автоверстки         │
# │     InDesign. 5 комплектаций × 2 типа листов × диапазоны учеников. │
# │   • docs/transition-section-spec.md (62c6815) — финальная спека    │
# │     после диалога: концепция, UI, типы, план из 8 подэтапов,       │
# │     открытые риски (3 шт).                                         │
# │                                                                    │
# │ КЛЮЧЕВЫЕ РЕШЕНИЯ (закреплены в spec.md):                           │
# │                                                                    │
# │   1. КОМПЛЕКТАЦИЯ = характеристика существующего шаблона, не       │
# │      новое поле. Engine выводит её автоматически из мастеров       │
# │      students-секции:                                              │
# │        N-Grid-12 → Мини, N-Grid-6 → Лайт, N-Grid-4 → Медиум,       │
# │        E-Student → Стандарт/Универсал, разворот → Максимум.        │
# │      Сергей подтвердил: «комплектация — это просто шаблон, чем     │
# │      мы и занимаемся — создаём конструктор шаблонов».              │
# │                                                                    │
# │   2. MISMATCH комплектаций возможен — основной режим               │
# │      «1 ученик/страницу» (E-Student) + дополнительная секция-      │
# │      сетка для детских фото (N-Grid-12 — детский сад тех же        │
# │      выпускников). Engine ориентируется на наличие сетки.          │
# │                                                                    │
# │   3. COMBO-МАСТЕРА — 3 универсальных (по комплектации):            │
# │        J-Combined-Tail-4 (Мини, 4 слота)                           │
# │        J-Combined-Tail-3 (Лайт, 3 слота)                           │
# │        J-Combined-Tail-2 (Медиум, 2 слота)                         │
# │      Лишние слоты скрываются через __hidden__<label> — рабочий     │
# │      прецедент в teachers.ts:516. Сергей рисует их в InDesign      │
# │      ПОСЛЕ реализации кода (для тестирования сначала используем    │
# │      стабы в БД).                                                  │
# │                                                                    │
# │   4. UI ШАБЛОНА — 2 режима переходного:                            │
# │      • «Стандартная логика OkeyBook» (дефолт) — engine применяет   │
# │        таблицу из xlsx                                             │
# │      • «Свой сценарий» — визуальный конструктор с двумя мокапами   │
# │        разворотов (хвост слева / хвост справа). Партнёр задаёт     │
# │        мастера для каждого случая заранее.                         │
# │      Точечные правки делаются на уровне альбома через              │
# │      существующую кнопку «Заменить шаблон правой страницы».        │
# │                                                                    │
# │   5. СИММЕТРИЗАЦИЯ — галочка в секции «Личный раздел»              │
# │      PresetEditorModal, под выбором N учеников. Активна только     │
# │      для N ∈ {6, 12}. Скрыта/disabled для других значений.         │
# │      Поведение: хвост = 1 ученик → engine забирает 1 ученика       │
# │      с предыдущей полной страницы → теперь хвост = 2, оба          │
# │      «дефицита» центрируются (placeholder_centering).              │
# │                                                                    │
# │   6. has_user_edits=true → engine не перезаписывает ручные         │
# │      правки партнёра при ре-сборке (как сейчас работает).          │
# │                                                                    │
# │ ПЛАН РЕАЛИЗАЦИИ РЭ.37 (8 ПОДЭТАПОВ, ~2-3 СЕССИИ):                  │
# │   РЭ.37.1 — типы SectionStructureEntry.transition + миграция БД    │
# │              (поле config_presets.symmetrize_students_tail)        │
# │   РЭ.37.2 — engine: fillTransitionSection с двумя режимами,        │
# │              таблица правил OkeyBook как данные                    │
# │   РЭ.37.3 — combo-мастера в каталоге БД (стабы без InDesign-арта)  │
# │   РЭ.37.4 — симметризация в engine (только Мини/Лайт, забор        │
# │              ученика, центрирование)                               │
# │   РЭ.37.5 — UI: галочка симметризации в PresetEditorModal          │
# │   РЭ.37.6 — UI: TransitionScenarioPicker с radio + визуальным      │
# │              конструктором                                         │
# │   РЭ.37.7 — тесты на 30+ кейсов из xlsx + edge cases mismatch      │
# │   РЭ.37.8 — Сергей рисует combo-мастера, заводит в template_set,   │
# │              приёмка на Тест2 + новых альбомах                     │
# │                                                                    │
# │ ОТКРЫТЫЕ РИСКИ К РЕШЕНИЮ ПО ХОДУ:                                  │
# │   • Автоматическое центрирование внутри combo-N — алгоритм в       │
# │     engine vs. отдельные композиции в InDesign (РЭ.37.4)           │
# │   • Mismatch комплектаций «детсад+школа» — один или два            │
# │     переходных раздела (РЭ.37.1)                                   │
# │   • Фильтр dropdown'а custom-режима по фактическому slot_capacity  │
# │     template_set (РЭ.37.6)                                         │
# │                                                                    │
# │ СОСТОЯНИЕ ПРОДА:                                                   │
# │   • 217/222 тестов engine зелёные (5 pre-existing fails не         │
# │     затронуты — legacy РЭ.22 семантика плотностей)                 │
# │   • UI warnings от РЭ.36.UI работает: партнёр видит предупреждения │
# │     автосборки плашкой под навигацией разворотов                   │
# │   • Тест2 после ре-сборки — 0 warnings (структура чистая)          │
# │   • Все 30 мастеров в БД совпадают с InDesign                      │
# │   • Template Set ID: 08baf556-7831-44e9-9ba8-4af20f19ee44          │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ (передача в новый чат под РЭ.37):                       │
# │   1. ОТКРЫТЬ НОВЫЙ ЧАТ под РЭ.37 со ссылкой на этот контекст +     │
# │      docs/transition-section-spec.md как стартовую точку.          │
# │   2. Первое сообщение в новом чате — стандартное «продолжаем       │
# │      работу, прочитай v155 + transition-section-spec.md».          │
# │   3. Начать с РЭ.37.1 (типы + миграция БД) после уточнения         │
# │      первого открытого риска (mismatch комплектаций) на примере.   │
# │   4. Дальше по плану 8 подэтапов выше.                             │
# │   5. Параллельно вне РЭ.37: Сергей дорисовывает мастера            │
# │      Приоритет 1 из docs/master-catalog.md и тестирует белый       │
# │      дизайн на 1-2 реальных альбомах.                              │
# │   6. РЭ.38 (гибридная авто-классификация общих фото) — после       │
# │      5-10 реальных партнёров на проде. Не сейчас.                  │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V154 (24.05.2026 ДЕНЬ)                                  │
# │                                                                    │
# │ ЗАКРЫТ РЭ.36.UI — ПЛАШКА ПРЕДУПРЕЖДЕНИЙ АВТОСБОРКИ В РЕДАКТОРЕ:    │
# │                                                                    │
# │ • РЭ.36.UI (3af371a) — индикатор «N предупреждений» под навигацией │
# │   разворотов в редакторе альбома. Решена проблема: engine писал    │
# │   warnings в album_layouts.warnings, API их возвращал, но UI       │
# │   игнорировал. Партнёр не понимал почему страницы пропускаются.    │
# │                                                                    │
# │   ЧЕТЫРЕ СВЯЗАННЫХ ИЗМЕНЕНИЯ:                                      │
# │                                                                    │
# │   1. lib/rule-engine/layout-to-buildresult.ts — парсинг            │
# │      реального кода warning'а. До фикса все engine-warnings        │
# │      сваливались в общий код 'rule_engine_warning', а реальные     │
# │      коды (common_required_page_skipped, slot_skipped и т.п.)      │
# │      терялись в detail. Regex /^([a-z][a-z0-9_]*):\s*/ извлекает   │
# │      префикс, остаток идёт в detail. Строки без префикса           │
# │      остаются на старом коде — обратно совместимо.                 │
# │                                                                    │
# │   2. app/api/layout/route.ts — добавил коды РЭ.32/РЭ.21.8 в        │
# │      WARNING_LEVELS map. До фикса они все попадали в дефолт        │
# │      'degraded' (одного цвета). Теперь:                            │
# │      • common_required_master_missing/_no_category/_page_skipped   │
# │        → degraded (жёлтый, требует внимания)                       │
# │      • common_required_empty/_spread_misaligned → info             │
# │        (синий, к сведению)                                         │
# │      • slot_skipped → degraded                                     │
# │      • common_no_spread_master / _autopack_underflow /             │
# │        _autopack_disabled → info                                   │
# │                                                                    │
# │   3. app/app/album/[id]/layout/_components/WarningsPill.tsx        │
# │      (новый файл, ~240 строк) — компонент-плашка.                  │
# │      • Свёрнутая: pill «⚠ N предупреждений» с цветом по            │
# │        максимальному уровню severity                               │
# │        (blocking красный > degraded жёлтый > info синий)           │
# │      • Развёрнутая: панель ~28rem с группировкой по уровню,        │
# │        для каждого warning'а — заголовок (CODE_TITLES словарь      │
# │        русских названий), detail из engine, сам код для отладки    │
# │      • Клик вне → сворачивается. role=dialog для accessibility.    │
# │      • Не рендерится при warnings.length === 0                     │
# │                                                                    │
# │   4. app/app/album/[id]/layout/page.tsx — расширил LayoutData      │
# │      полем warnings, извлекаю из API, рендерю WarningsPill в       │
# │      одном ряду с pill «Мягкий переплёт». Если оба условия пусты, │
# │      ряд не виден (canvas получает всю высоту).                    │
# │                                                                    │
# │ СЛОВАРЬ ПЕРЕВОДА КОДОВ В UI (CODE_TITLES в WarningsPill.tsx):      │
# │   Покрывает 23 кода — common_required_*, slot_skipped, common_*    │
# │   (auto/manual), master_not_found, students_*, name_mismatch,      │
# │   class_photo_missing, half_class_missing, fallback_used,          │
# │   adaptive_grid_fallback, no_head_teacher, students_no_portrait,   │
# │   per_child_override_ignored, rule_engine_warning/_partial.        │
# │   Если новый код не в словаре — показывается сам код (для отладки).│
# │                                                                    │
# │ СОСТОЯНИЕ ПРОДА:                                                   │
# │   • 217/222 тестов engine зелёные (5 pre-existing fails не         │
# │     затронуты — legacy РЭ.22 семантика плотностей)                 │
# │   • UI редактора: warnings видимы партнёру (требует ре-сборки      │
# │     альбома для получения свежего layout.warnings)                 │
# │   • Тест2 после ре-сборки → 0 warnings (структура чистая)          │
# │   • Все 30 мастеров в БД совпадают с InDesign                      │
# │   • Template Set ID: 08baf556-7831-44e9-9ba8-4af20f19ee44          │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ — см. блок V155 выше (план обновлён 24.05.2026 вечер,   │
# │ спека РЭ.37 закрыта, готова к реализации).                         │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V153 (24.05.2026 УТРО)                                  │
# │                                                                    │
# │ ЗАКРЫТ РЭ.36 — ФИКС ДУБЛИРОВАНИЯ ФОТО В COMMON_REQUIRED:           │
# │                                                                    │
# │ • РЭ.36 (9fc708d) — analyzeMasterCapability для J-Collage-4        │
# │   возвращал category='quarter', но bindCommonPhotos для labels     │
# │   collagephoto_N всегда читает из common_photos.sixth. Рассинхрон: │
# │   decrement шёл с quarter, ability-проверка тоже по quarter-пулу.  │
# │   ТЕОРЕТИЧЕСКИ должно было давать дублирование фото между двумя    │
# │   соседними J-Collage-4 (cursor sixthUsed не сдвигался). На        │
# │   практике в Тест2 24.05 Сергей фактического дублирования НЕ       │
# │   наблюдал — фото были разные. Возможно симптом был артефактом     │
# │   более ранней версии кода или неточным описанием в v152.          │
# │                                                                    │
# │   ФИКС ВСЁ РАВНО ПОЛЕЗЕН (защитный, нулевые регрессии):            │
# │   1. J-Collage-N универсально для любого N (3, 5, 7, 8) без        │
# │      правок кода. До фикса работало строго 4 и 6.                  │
# │   2. Корректная проверка нехватки фото: если sixth-пул пуст,       │
# │      engine честно даст page_skipped warning. До фикса для         │
# │      J-Collage-4 проверка шла по quarter-пулу — могло "прокатить"  │
# │      при пустом sixth с неправильными bindings.                    │
# │   3. Гигиена кода: ability и bind согласованы — «collagephoto_N    │
# │      → sixth-пул» одинаково в обоих местах.                        │
# │                                                                    │
# │   Изменение: одна строка в lib/rule-engine/sections/               │
# │   common-required.ts — обобщённое правило 'collageCount > 0 →      │
# │   category sixth, count = collageCount'.                           │
# │                                                                    │
# │   Тесты: +3 кейса в sections-common-required.test.ts (8 → 11).     │
# │   Регрессий нет: 5 pre-existing fails в students/common-additional │
# │   остались теми же.                                                │
# │                                                                    │
# │ ЗАФИКСИРОВАНО СТРАТЕГИЧЕСКОЕ РЕШЕНИЕ:                              │
# │   Текущий UI родителей сохраняем (5 категорий пулов: spread /      │
# │   full_class / half_class / quarter / sixth). Сергей доволен,      │
# │   собирается идеально, предсказуемо. Через 2-3 месяца после старта │
# │   партнёрки опросить 5-10 партнёров: «готов ли размечать по 5      │
# │   категориям?». Если ≥60% да → оставить + переименовать «Фото 1/6  │
# │   класса» в «Коллажные фотографии». Если <60% → внедрить           │
# │   РЭ.38 «гибридная авто-классификация» (AI первичная сортировка    │
# │   по числу лиц/композиции + ручная корректировка партнёром). До    │
# │   реальных партнёров не делаем — гипотеза, дорого проверять.       │
# │                                                                    │
# │ СОСТОЯНИЕ ПРОДА:                                                   │
# │   • 217/222 тестов engine зелёные (5 pre-existing fails не         │
# │     затронуты — legacy РЭ.22 семантика плотностей)                 │
# │   • Тест2 структурно идентичен v152 (Сергей подтвердил после       │
# │     ре-сборки 24.05 — визуально без изменений, фикс защитный)      │
# │   • Все 30 мастеров в БД совпадают с InDesign                      │
# │   • Template Set ID: 08baf556-7831-44e9-9ba8-4af20f19ee44          │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ — см. блок V154 выше (план обновлён 24.05.2026 день).   │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО БЫЛО В V152 (23.05.2026 ВЕЧЕР)                                 │
# │                                                                    │
# │ ЗАКРЫТЫ ВСЕ ФИКСЫ РЭ.35.Е/Ж — ПОЛНАЯ ПРИЁМКА РЕДАКТОРА:            │
# │                                                                    │
# │ • РЭ.35.Е.3 (2565f33) — drag&drop работал на ОБЕИХ страницах       │
# │   разворота сразу. FIX: dnd-kit id='{label}@{instanceKey}',        │
# │   handleDragEnd парсит обратно. БОНУС: swap фото между left/right  │
# │   страницами разворота.                                            │
# │                                                                    │
# │ • РЭ.35.Е.5 (ed8d04f) — soft форзацы: первая страница массива      │
# │   стала правой первого визуального разворота (левая=форзац),       │
# │   последняя — левой последнего (правая=форзац). Жёлтая плашка      │
# │   «Мягкий переплёт» сжата в pill с tooltip.                        │
# │                                                                    │
# │ • РЭ.35.Ж.1 (0344d02) — section_start барьер между секциями.       │
# │   PageInstance.section_start?: boolean. После common_required и    │
# │   soft_final первая страница помечается section_start=true. Шаг 6  │
# │   группировки закрывает предыдущий разворот висящим.               │
# │                                                                    │
# │ • РЭ.35.Ж.2 (8e0e52d) — J-Spread больше не пропускается при        │
# │   нечётной позиции. Раньше: при misaligned состоянии страница      │
# │   терялась полностью (Сергей видел дыру; удаление J-Spread из      │
# │   шаблона убирало баг). FIX: при нечётности первая запись J-Spread │
# │   получает section_start=true.                                     │
# │                                                                    │
# │ • РЭ.35.Ж.3 (5a9c2e2) — жёсткая привязка LEFT/RIGHT в общем        │
# │   разделе. virtualPos счётчик: партнёр в шаблоне видит позиции    │
# │   1=LEFT, 2=RIGHT, 3=SPREAD, 4=LEFT, 5=RIGHT — engine ОБЯЗАН        │
# │   соблюдать. expectedSide vs actualSide → sideMismatch триггерит   │
# │   section_start.                                                   │
# │                                                                    │
# │ • РЭ.35.Ж.4 (bea5024) — section_start ПРОБРАСЫВАЕТСЯ через         │
# │   adapter. Корневая причина «фикс не работает»: Ж.1-3 работали     │
# │   в engine, но adapter layout-to-buildresult терял флаг при        │
# │   конвертации PageInstance → legacy SpreadInstance. FIX:           │
# │   legacy SpreadInstance.section_start?:boolean, adapter            │
# │   пробрасывает, UI segmentToSpreads уважает.                       │
# │                                                                    │
# │ ПОЛНАЯ ПРИЁМКА Сергеем (JSON+скрины 23.05 вечер):                  │
# │   9 разворотов Тест2 = идеальная структура:                        │
# │   1) форзац+intro · 2) teachers+G-Half · 3-4) students             │
# │   5) Фёдорова ВИСЯЩИЙ (левая, правая=пусто)                        │
# │   6) J-Collage-4 + J-Collage-4 (партнёрский контракт!)             │
# │   7) J-Spread (целый) · 8) J-Half + J-Half                         │
# │   9) S-Final ВИСЯЩИЙ (левая, правая=форзац)                        │
# │                                                                    │
# │ ОБНАРУЖЕНЫ ВТОРОСТЕПЕННЫЕ БАГИ:                                    │
# │   1. ✅ ЗАКРЫТО в РЭ.36 (24.05): дублирование фото в               │
# │      common_required.J-Collage-4. Фикс — обобщённое правило        │
# │      'collageCount > 0 → category sixth'.                          │
# │   2. Симметризация хвоста students — Фёдорова сейчас висит одна.   │
# │      Хорошо бы взять ещё ученика с предыдущей страницы для парного │
# │      хвоста. Большая фаза, требует переделки students-секции.     │
# │   3. Конструктор переходного раздела (РЭ.37) — гибкая логика 1     │
# │      или 2 страниц, выбор поведения партнёром.                     │
# │   4. UI не показывает warnings от engine — партнёр не понимает     │
# │      почему страницы пропускаются (common_required_page_skipped).  │
# │                                                                    │
# │ СОСТОЯНИЕ ПРОДА (verified JSON):                                   │
# │   • 215/220 тестов engine зелёные (5 pre-existing fails не         │
# │     затронуты — legacy РЭ.22 семантика плотностей)                 │
# │   • Тест2: 14 страниц в layout, 0 warnings, 9 визуальных разворо- │
# │     тов в strip. structure 1:1 с шаблоном «Мой шаблон999»          │
# │   • Все 30 мастеров в БД совпадают с InDesign                      │
# │   • Template Set ID: 08baf556-7831-44e9-9ba8-4af20f19ee44          │
# │                                                                    │
# │ ВСЕГО КОММИТОВ В СЕССИИ 23.05.2026:                                │
# │   2565f33 РЭ.35.Е.3 — drag фикс                                    │
# │   ed8d04f РЭ.35.Е.5 — soft форзацы                                 │
# │   0344d02 РЭ.35.Ж.1 — section_start базовая логика                 │
# │   8e0e52d РЭ.35.Ж.2 — J-Spread misaligned                          │
# │   5a9c2e2 РЭ.35.Ж.3 — жёсткая привязка LEFT/RIGHT                  │
# │   bea5024 РЭ.35.Ж.4 — проброс section_start через adapter          │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ — см. блок V153 выше (план обновлён 24.05.2026).        │
# └────────────────────────────────────────────────────────────────────┘
#
# ┌────────────────────────────────────────────────────────────────────┐
# │ ЧТО НОВОГО ПОСЛЕ V150 (21.05 → 23.05.2026)                         │
# │                                                                    │
# │ ЗАКРЫТЫ ФАЗЫ:                                                      │
# │  • РЭ.32 — Конструктор общего раздела + переходной мастер в шаблоне│
# │    (партнёр сам собирает упорядоченный список страниц общего раздела│
# │     из доступных в шаблоне J-* мастеров; engine исполняет строго)  │
# │  • РЭ.35 — Редактор работает разворотами (canvas показывает 2      │
# │    страницы рядом; strip с гибридной моделью «визуально развороты, │
# │    drag&drop постранично»)                                         │
# │                                                                    │
# │ ОТМЕНЕНА:                                                          │
# │  • РЭ.31 (семантический поиск J-мастеров через slot_capacity) —    │
# │    откачена через git revert. У всех J-* в БД slot_capacity={}.    │
# │    Решение — партнёр сам конструирует через РЭ.32, не нужно        │
# │    автоматического подбора.                                        │
# │                                                                    │
# │ СОЗДАНЫ ДОКУМЕНТЫ:                                                 │
# │  • docs/master-catalog.md — каталог 30 мастеров «Белый плотные»    │
# │    (компактные таблицы: что есть, что дорисовать)                  │
# │  • docs/designer-brief.md — техзадание дизайнеру для нового        │
# │    дизайна с фоном                                                 │
# │  • docs/phase-Р32-spec.md — финальный spec фазы 32                 │
# │                                                                    │
# │ СОСТОЯНИЕ ПРОДА:                                                   │
# │  • Тест2 (16 страниц): собирается чисто, 0 warnings                │
# │  • Все 30 мастеров в БД совпадают с InDesign                       │
# │  • Template set ID: 08baf556-7831-44e9-9ba8-4af20f19ee44            │
# │  • Все J-* page_role=null (универсальные)                          │
# │  • F-Head-* page_role='teacher_left' — но build-from-section-      │
# │    structure (РЭ.32 поток) page_role не использует как фильтр,     │
# │    партнёр через конструктор кладёт куда угодно                    │
# │                                                                    │
# │ ЧТО НА ПАУЗЕ:                                                      │
# │  • РЭ.33 — Чистка терминологии (preset→шаблон, template_set→дизайн)│
# │  • РЭ.34 — Quick-start пресетов (для партнёра карточки дизайнов)   │
# │  • РЭ.36 — Конструктор всех разделов (опциональный master_name     │
# │    для teachers/students/soft_intro)                               │
# │  • Заполнение 7 пресетов через UI — ЖДЁТ дорисовки                 │
# │    недостающих мастеров (Приоритет 1 и 2 в master-catalog.md)      │
# │                                                                    │
# │ ЧТО ДАЛЬШЕ (порядок Сергея, 22.05.2026):                           │
# │  1. Сергей тестирует редактор Тест2, ловит баги, шлёт фидбэк       │
# │  2. Сергей дорисовывает недостающие мастера в InDesign             │
# │  3. Загружает обновлённый indd → 30+ мастеров                      │
# │  4. Тестируем белый дизайн на 1-2 реальных альбомах                │
# │  5. Заказываем второй дизайн с фоном (по designer-brief.md)        │
# └────────────────────────────────────────────────────────────────────┘
#
# 🎉 ФАЗА РЭ.30 ЗАКРЫТА — чистка путей сборки альбома
# ──────────────────────────────────────────────────────────────────
# Все 7 коммитов фазы сделаны 21.05.2026. Фаза заняла одну сессию
# (после закрытия РЭ.27 и РЭ.28 в той же сессии).
# Главный summary: docs/phase-Р30-summary.md.
# Spec: docs/phase-Р30-spec.md (commit 8d5b996).
# Диагностика: docs/phase-Р30-diagnostic.md (commit fe3ce67).
#
# Главный результат:
#   • В форме альбома единственный путь задания структуры — виджет
#     «Шаблон» (section_structure_preset_id). Селекты «Комплектация»
#     и «Тип печати» удалены.
#   • В обзоре альбома нет лишнего селекта «Section Structure» —
#     структура определяется выбранным шаблоном.
#   • В редакторе шаблона (`PresetEditorModal`) нет полей
#     «Плотность портретов» и «Тип листов». Только семантические
#     параметры: Режим + grid_size/friends + has_quote.
#   • Все 7 глобальных пресетов мигрированы на семантическую модель
#     (density=NULL, student_layout_mode заполнен, template_set_id
#     указывает на okeybook-default).
#   • Партнёрские смешанные пресеты очищены (mixed_remaining=0).
#   • E-* мастера: applies_to_configs снят (пустой массив).
#
# Финальное состояние данных в Supabase (после Б.1 + Б.3):
#   Все 7 глобальных пресетов:
#     standard:   layout_mode=page,   friends=0,  quote=true
#     universal:  layout_mode=page,   friends=2,  quote=true
#     maximum:    layout_mode=spread, friends=4,  quote=true
#     individual: layout_mode=spread, friends=4,  quote=true
#     medium:     layout_mode=grid,   grid_size=4,  quote=true
#     light:      layout_mode=grid,   grid_size=6,  quote=false
#     mini-soft:  layout_mode=grid,   grid_size=12, quote=false
#   density=NULL у всех 7. template_set_id=08baf556-... у всех.
#
# Все коммиты фазы (7 кода + 8 контекстов + 2 SQL миграции):
#   2992821 — Б.1 SQL миграция глобальных пресетов
#   16c7f80 — docs v144
#   73cd5ed — Б.2 PresetEditorModal не пишет density/sheet_type
#   4878c3b — docs v145
#   bb0d7f9 — Б.3 SQL миграция cleanup смешанных
#   c7887ae — docs v146
#   4455a8b — В.1 убран селект Section Structure из обзора
#   1418ad1 — docs v147
#   1bc8d76 — В.2 убраны поля Плотность/Тип листов
#   55cd182 — docs v148
#   74438d4 — В.3 убран блок Комплектация+Тип печати
#   6ce3818 — docs v149
#   (текущий) — Г.1 summary + docs v150 ФАЗА ЗАКРЫТА
#
# Долг фазы (зафиксирован в summary §«Что не сделано»):
#   • Семантический общий раздел (common_required) → следующая логичная
#     фаза, по запросу
#   • Удаление колонок presets.density, presets.sheet_type,
#     config_presets.print_type, albums.config_preset_id → отдельной
#     фазой когда уйдут 12 legacy-альбомов с прода
#   • Удаление legacy движка buildAlbum → отдельной фазой
#   • State form.config_type и form.print_type в AlbumFormModal
#     стали dead state после В.3 — почистить при следующей правке
#   • Партнёрский cover_preview_url у клонов template_set → долг РЭ.28
#
# Тесты на main: 492/492 passing (без изменений — фаза без unit-тестов).
#
# ⚠️ УСПЕХ ПРИМЕНЕНИЯ УРОКА РЭ.27:
#   Перед каждой миграцией снято реальное состояние БД (через выгрузку
#   Сергея из Supabase). Это поменяло тактику Б.1: миграция написана
#   как «sync to known state» (UPDATE'ы по id с явным значением всех
#   полей), а не «migrate from current to target». Никаких новых
#   открытий, никаких откатов, никаких фиксов. Правило работает.
#
# ⚠️ Эта фаза ДЕСТРУКТИВНАЯ (не как РЭ.27/28):
#   - Меняет поведение системы (не аддитивно)
#   - После каждого подэтапа обязательный ручной тест в браузере
#   - Возможны регрессии, будем чинить по ходу
#
# Решения Сергея (зафиксированы в spec):
#   1. Legacy-альбомы оставить, не трогать
#   2. «Плотность портретов» убрать совсем из UI
#   3. applies_to_configs снять полностью ([])
#   4. Глобальные пресеты Сергей пересоздаст сам — чистка минимальная
#   5. Общий раздел не блокер фазы, J-мастера вручную
#
# 🎉 ФАЗА РЭ.28 ЗАКРЫТА — партнёрские дизайны (сценарий A)
# 🎉 ФАЗА РЭ.27 ЗАКРЫТА — print_type в альбоме + правила переплёта
# ──────────────────────────────────────────────────────────────────
# Все подэтапы 28.0..28.6 закрыты. Фаза заняла одну сессию 21.05.2026
# (сразу после закрытия РЭ.27 в той же сессии).
# Главный summary: docs/phase-Р28-summary.md (310 строк).
# Финальный commit фазы: a68f2bb (summary).
#
# Главный результат:
#   • Партнёр может клонировать глобальный template_set с измененными
#     размерами под свою типографию.
#   • Все мастера и placeholder'ы пересчитываются пропорционально.
#   • Округление до целых пикселей при 300 DPI (хардкод).
#   • Защита от плохих пропорций: <5% ok, 5-10% warning, >10% blocked.
#   • UI модалка с real-time предпросмотром (mm + ≈ px подсказка).
#   • Раздел «Мои дизайны» в каталоге /app/templates.
#   • Удаление своих клонов с защитой от каскадного удаления при ссылках.
#
# Финальное состояние БД (применено в Supabase):
#   template_sets.parent_template_set_id uuid NULL с FK самоссылкой
#   ON DELETE SET NULL + partial индекс.
#   3 оригинальных глобальных template_set'а имеют parent=NULL.
#
# Тесты на main: 492/492 passing (437 + 55 новых в 28.2).
#
# Все коммиты фазы (6 кода + 6 контекстов + 1 миграция):
#   1193b5d — РЭ.28.0 spec
#   68a7f0a — РЭ.28.1 миграция БД (применена в Supabase)
#   888f58c — РЭ.28.2 чистые утилиты + 55 unit-тестов
#   0b8eced — РЭ.28.3 API endpoints (clone/my_list/delete)
#   e22ceae — РЭ.28.4 UI каталога (разделы + кнопки)
#   f98df1c — РЭ.28.5 UI модалка (real-time aspect check)
#   a68f2bb — РЭ.28.6 summary (ФАЗА ЗАКРЫТА)
#
# ⚠️ УСПЕХ ПРИМЕНЕНИЯ УРОКА РЭ.27:
#   В РЭ.27 было 4 расхождения ментальной модели и реальности БД.
#   В РЭ.28 правило «information_schema перед каждой миграцией»
#   применено трижды (28.0, 28.1, 28.3) — НИКАКИХ новых открытий.
#   Фаза прошла без откатов миграций, фиксов, перезаписей.
#   Правило работает. Зафиксировано в phase-Р28-summary §«Применение
#   урока РЭ.27 — успех».
#
# Долг фазы (зафиксирован в summary §«Что не сделано»):
#   • Сценарий B (партнёрский IDML с нуля) → РЭ.29+ по запросу
#   • Графический редактор placeholder'ов
#   • Расширенный DPI (240, 600)
#   • Update-of-clone при изменении оригинала
#   • Шеринг клонов между партнёрами
#   • Партнёрский cover_preview_url
#
# 🎉 ФАЗА РЭ.27 ЗАКРЫТА — print_type в альбоме + правила переплёта
#
# ✅ Миграция РЭ.28.1 применена в Supabase (Сергей подтвердил).
#
# Что готово после 28.5 (вся функциональность фазы):
#   • Engine (РЭ.28.2): 5 чистых модулей + 55 unit-тестов
#   • API (РЭ.28.3): template_set_clone / my_list / delete
#   • UI каталога (РЭ.28.4):
#     - Разделы «Мои дизайны» и «Глобальные шаблоны OkeyBook»
#     - Кнопка «Создать на основе...» на глобальных
#     - Кнопка «Удалить» на своих с confirm + API call + reload
#     - Размеры (мм) на карточке
#   • UI модалка (РЭ.28.5):
#     - Поля: name, page_width_mm, page_height_mm, bleed_mm (опц.)
#     - Подсказки mm → ≈ px при 300 DPI
#     - Real-time check совместимости пропорций (ok/warning/blocked)
#     - Цвет блока aspect-check меняется по уровню
#     - При blocked кнопка «Создать» disabled
#     - POST template_set_clone при submit → reload designs_list
#     - Обработка ошибок 400/409/500 из API
#
# План подэтапов РЭ.28:
#   ✅ 28.0 — spec (commit 1193b5d)
#   ✅ 28.1 — миграция БД (commit 68a7f0a, применена)
#   ✅ 28.2 — чистые утилиты + 55 unit-тестов (commit 888f58c)
#   ✅ 28.3 — API endpoints (commit 0b8eced)
#   ✅ 28.4 — UI каталога (commit e22ceae)
#   ✅ 28.5 — UI модалка ввода размеров (commit f98df1c)
#   ⏳ 28.6 — summary + закрытие фазы
#
# Тесты на main: 492/492 passing (стабильно после 28.2).
#
# ⚠️ ПРАВИЛО ИЗ УРОКОВ РЭ.27 (обязательное действие):
# Перед каждым подэтапом, особенно с миграцией:
#   1. SELECT column_name, data_type FROM information_schema.columns
#      WHERE table_name = '...'
#   2. Test JOIN на 5 строках чтобы убедиться что связи работают
#   3. Только потом писать код миграции/запрос
#
# 🎉 ФАЗА РЭ.27 ЗАКРЫТА — print_type в альбоме + правила переплёта
# ──────────────────────────────────────────────────────────────────
# Все подэтапы 27.0..27.8 закрыты. Фаза заняла одну сессию 21.05.2026.
# Главный summary: docs/phase-Р27-summary.md (318 строк).
# Финальный commit фазы: 663cddb (summary).
#
# Главный результат:
#   • Тип переплёта (layflat/soft) переехал из пресета в альбом.
#   • Дубль-пресеты 'Стандарт-layflat'/'Стандарт-soft' слиты в один
#     'Стандарт'. В config_presets теперь 7 чистых записей вместо 14.
#   • Партнёр может менять тип листов БЕЗ смены пресета (селект
#     «Тип листов в альбоме» в форме).
#   • Engine собирает альбом по типу из albums.print_type
#     (с fallback на пресет для бэк-совместимости).
#   • Защита spread-мастеров для soft в двух местах: engine + UI.
#   • Визуальные форзацы «Форзац» в редакторе для soft-альбомов.
#
# Финальное состояние БД (применено в Supabase):
#   albums.print_type:  layflat=9, soft=3, NULL=0 ✅
#   config_presets:     7 записей (individual, light, maximum, medium,
#                       mini, standard, universal)
#
# Тесты на main: 437/437 passing.
#
# Все коммиты фазы (12 кода + 1 fix + 9 контекстов):
#   266341a — РЭ.27.0 spec
#   d4ff79e — РЭ.27.1 миграция (no-op + индекс)
#   5a52544 — РЭ.27.1 корректировка после открытия #1
#   3096c18 — РЭ.27.2 API: явный print_type
#   d8ea615 — РЭ.27.3 engine + 30 unit-тестов
#   2ca86f2 — РЭ.27.4 UI плашка + заглушка «Форзац»
#   504e0c4 — РЭ.27.4 fix (config_presets, не presets) — открытие #3
#   ed380a3 — РЭ.27.5 UI палитры: spread-мастера серые
#   c421897 — РЭ.27.6 UI формы: селект «Тип листов»
#   ec08837 — РЭ.27.7 миграция v1 (откатилась, открытие #4)
#   199e2a9 — РЭ.27.7 миграция v2 (UUID-based, применена)
#   a936964 — РЭ.27.7b черновики → layflat
#   8cd1090 — РЭ.27.7c cleanup кода
#   663cddb — РЭ.27.8 summary (ФАЗА ЗАКРЫТА)
#
# ⚠️ 4 ОТКРЫТИЯ ФАЗЫ (расхождение ментальной модели и реальности БД):
#   1. РЭ.27.1: колонка albums.print_type СУЩЕСТВОВАЛА с 8 мая 2026.
#   2. РЭ.27.2: update_album.allowedFields УЖЕ содержал print_type,
#      но был перетирающий код.
#   3. РЭ.27.4: запрос к таблице 'presets' (новая, uuid) вместо
#      'config_presets' (legacy, slug). Fix в 504e0c4.
#   4. РЭ.27.7: миграция v1 предполагала config_preset_id=text, JOIN
#      по slug. Реально config_preset_id=uuid, FK на config_presets.id.
#
# Цена отлова была минимальной благодаря защитам (BEGIN/COMMIT,
# IF NOT EXISTS, maybeSingle()), но в более рискованной фазе они
# стоили бы дороже.
#
# Правило на будущее (зафиксировано в summary §«Уроки фазы»):
# ПЕРЕД КАЖДЫМ ПОДЭТАПОМ, особенно с миграцией:
#   1. SELECT column_name, data_type FROM information_schema.columns
#      WHERE table_name = '...'
#   2. Test JOIN на 5 строках
#   3. Только потом писать код миграции/запрос
#
# Долг фазы (зафиксирован в summary §«Что НЕ сделано»):
#   • Удаление config_presets.print_type (оставлено deprecated)
#   • Confirmation при смене типа листов если есть spread-мастера
#     (развилка G — пока нет необходимости)
#   • PDF-экспорт с водяным знаком «Форзац»
#   • Расширенные роли page_role (common_spread / student_spread)
#   • Принудительная парность страниц для soft
#
# 🎉 ФАЗА РЭ.25 ЗАКРЫТА — Галка покупки альбома ребёнком
# ──────────────────────────────────────────────────────────────────
# 8 подэтапов (25.0..25.7), 14 коммитов на main.
# Полный summary: docs/phase-Р25-summary.md (210 строк).
# Финальный commit фазы: 22d5ccd (РЭ.25.7 — summary).
#
# Что готово после фазы:
#   • Ребёнок с is_purchased=false НЕ получает персональной страницы
#     в личном разделе (но остаётся в общих фото и виньетке).
#   • Альбом получает флаг include_non_purchasers для мягкого режима
#     («всем по странице независимо от заказа»).
#   • Галку проставляют ОБА — фотограф в /app (колонка «Заказ» в таблице)
#     и родитель в /[token] (постоянный чекбокс над шагами).
#   • CSV-экспорт получил колонку «Заказ» для автовёрстки InDesign.
#   • Карточка альбома показывает «Заказали: N из M» только когда есть
#     не-заказчики и не мягкий режим (минимум визуального шума).
#   • 12 новых unit-тестов на чистый фильтр (407/407 на main, было 395).
#
# Архитектурное решение фазы:
#   Фильтр живёт в lib/smart-fill/filter-by-purchase.ts — чистая функция
#   без зависимости от Supabase. Применяется ДО входа в buildAlbum.
#   Engine (lib/album-builder) остаётся непрозрачным к is_purchased.
#   Один источник истины — легко тестировать, легко отлаживать.
#
# Зафиксировано как долг (не сделано в фазе):
#   • Уведомление фотографу о смене статуса родителем после submit
#     (возможное расширение через parent_messages).
#   • История изменений is_purchased на уровне поля (audit log).
#   • Связь с биллингом (отдельный канал у Сергея).
#
# 🎉 ФАЗА РЭ.24 ЗАКРЫТА — Готовые шаблоны для быстрого старта партнёра
# ──────────────────────────────────────────────────────────────────
# 11 подэтапов (24.0..24.8 + 24.5b), ~25 коммитов на main.
# Полный summary: docs/phase-Р24-summary.md (195 строк).
# Финальный commit фазы: 3d0c4f2 (РЭ.24.8 — summary).
#
# 🎉 ФАЗА РЭ.24 ЗАКРЫТА — Готовые шаблоны для быстрого старта партнёра
# ──────────────────────────────────────────────────────────────────
# 11 подэтапов (24.0..24.8 + 24.5b), ~25 коммитов на main.
# Полный summary: docs/phase-Р24-summary.md (195 строк).
# Финальный commit фазы: 3d0c4f2 (РЭ.24.8 — summary).
#
# Что готово после фазы:
#   • Партнёр видит '📐 Шаблоны' в шапке /app
#   • Двухуровневая навигация: /app/templates → выбор дизайна,
#     /app/templates/[designId] → каталог шаблонов внутри
#   • Карточки с превью (1 крупное students + 3 малых)
#   • Клонирование готовых шаблонов в личную библиотеку
#   • Создание blank шаблона с привязкой к дизайну
#   • Редактирование через переиспользование PresetEditorModal
#   • Удаление с проверкой активных альбомов (409 если есть)
#   • При создании альбома — модалка TemplatePickerModal с фильтром
#     по дизайну, секциями Мои/Готовые, confirm при смене шаблона
#   • Старая legacy-логика (config_type+print_type) сохранена для
#     обратной совместимости
#   • Галка is_recommended в /super/presets (без SQL UPDATE)
#
# Архитектурные долги зафиксированы в docs/phase-Р24-spec.md v1.4:
#   §12 multi-design (template_set = дизайн)
#   §13 print_type → альбом (фаза РЭ.27)
#   §14 партнёрские дизайны (фазы РЭ.28 A и РЭ.29+ B)
#   §15 терминология (шаблон/дизайн/комплектация/тип листов)
#
# Скрытые баги фазы РЭ.24 (все закрыты по ходу):
#   #1 (РЭ.24.3): пустой section_structure → ранний выход engine
#      до fallback. Закрыт флагом engineProducedPages.
#   #2 (РЭ.24.7): проверка patch.length=0 ДО обработки is_recommended
#      → API не сохранял галку. Перенёс проверку выше.
#
# 🎉 ФАЗА РЭ.23 ЗАКРЫТА — визуальный каталог мастеров.
# 🎉 ФАЗА РЭ.22 ЗАКРЫТА — двух-осевая модель + семантический engine.
#
# ⏳ Следующий подэтап: РЭ.25.1 — миграция БД.
#    SQL: ALTER TABLE children ADD COLUMN is_purchased BOOLEAN
#         NOT NULL DEFAULT true;
#         ALTER TABLE albums ADD COLUMN include_non_purchasers BOOLEAN
#         NOT NULL DEFAULT false;
#         CREATE INDEX idx_children_is_purchased_album ON children
#         (album_id, is_purchased);
#    Файл: migrations/2026-05-21-children-is-purchased-and-album-include-non-purchasers.sql
#    Применяется в Supabase ДО деплоя кодовых правок (правило аддитивной
#    миграции — см. правила миграций в конце файла).
#    Полное описание: docs/phase-Р25-spec.md §3.
#
# План фаз после РЭ.25:
#   РЭ.27 — print_type в АЛЬБОМЕ, не в пресете (10-15 коммитов).
#     Тип листов определяет ВИЗУАЛЬНУЮ МОДЕЛЬ РЕДАКТОРА:
#       layflat → разворотный режим (2 страницы как одна зона работы)
#       soft → постраничный + правила 'первая правая, последняя левая'
#     См. docs/phase-Р24-spec.md §13.
#   РЭ.28 — партнёрские дизайны сценарий A (5-7 коммитов):
#     копирование глобального template_set с переопределением размеров.
#     Жёсткое ограничение: разница пропорций ≤ 5% автомат, > 5% warning.
#     См. docs/phase-Р24-spec.md §14.
#   РЭ.29+ — партнёрский IDML сценарий B, без даты, по запросу.
#
# Тесты на main после фазы РЭ.24: 395/395 passing (369 до фазы, +26).
#
# ─── Скрытые баги фазы РЭ.22 (все закрыты по ходу) ────────────────────
# • #1 (РЭ.22.2): loaders.ts не пробрасывал student_* поля
# • #2 (РЭ.22.6): известная коллизия L-Grid-12 vs N-Grid-Page (D.1)
# • #3 (РЭ.22.7.2): legacy ищет G-Teachers-4x3, в БД G-Teachers-3x4
# • #4 (РЭ.22.8.1 fix 5187361): CHECK constraint без 'final'
#
# ─── Известные аномалии данных ────────────────────────────────────────
# • L-Grid-12: is_spread=true, но placeholders только в левой половине.
#   Не баг превью, аномалия БД. Исправить при пересохранении из InDesign.
#
# ─── Предыдущая сессия (закрыта) — Доработка редактора Р.1+Р.2+Р.3 ────
# 20.05.2026, три новые фичи редактора /app/album/[id]/layout. См. коммиты
#   45776ed (Р.1), 15a3303 (Р.2), b4bcb88 (Р.3).
#
# 📌 Архитектурный долг — РЭ.27 (после закрытия РЭ.24):
#    print_type должен жить в АЛЬБОМЕ, не в пресете. Тип листов
#    определяет ВИЗУАЛЬНУЮ МОДЕЛЬ РЕДАКТОРА (layflat → разворотный,
#    soft → постраничный). См. docs/phase-Р24-spec.md §13.
#
# 📌 Архитектурный долг — РЭ.28 (партнёрские дизайны, после РЭ.27):
#    Партнёр копирует глобальный template_set с переопределением
#    размеров под свою типографию. Engine уже частично умеет ресайз.
#    Жёсткое ограничение: разница пропорций ≤ 5% → автомат, > 5% →
#    предупреждение. См. docs/phase-Р24-spec.md §14.
#
# 📌 Будущая фаза РЭ.25 (после РЭ.24, до РЭ.27): галка покупки альбома
#    ребёнком (children.is_purchased BOOLEAN). Engine не включает в
#    студенческую секцию тех кто не заказывал. Маленькая фаза 1-2 дня.
#
# Архитектура РЭ.24 — 4 уровня:
#   1. ГЛОБАЛЬНЫЕ — presets WHERE tenant_id IS NULL
#   2. КАТАЛОГ /app/templates ✅ (двухуровневая навигация, мульти-дизайн)
#   3. ЛИЧНАЯ БИБЛИОТЕКА — presets WHERE tenant_id = X
#   4. ВЫБОР ПРИ АЛЬБОМЕ ✅ (РЭ.24.6 модалка + confirm-диалог)
#
# Подэтапы фазы:
#   ✅ 24.0..24.5 — закрыты
#   ✅ 24.5b — multi-design расширение
#   ✅ 24.6 — UI: модалка выбора шаблона при создании альбома
#   ✅ 24.7 — UI: галка is_recommended в /super/presets
#   ⏳ 24.8 — summary + закрытие фазы
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
# 📍 КАК НАЧАТЬ СЛЕДУЮЩУЮ СЕССИЮ (важно для нового чата):
#   1. cd ~/yearbook-v2 && git pull
#   2. ls yearbook-context-v*.md | sort -V | tail -1  → должен показать v143
#   3. ОБЯЗАТЕЛЬНО прочитать:
#      • Шапка v143 — фаза РЭ.30 стартовала, начинать с Б.1
#      • docs/phase-Р30-spec.md — полный план фазы (283 строки)
#      • docs/phase-Р30-diagnostic.md — карта реального состояния
#   4. Применены в Supabase: ВСЕ миграции до РЭ.28.1 включительно ✅
#      + UPDATE'ы 21.05.2026 глобальных пресетов на семантику
#        (см. spec §«Состояние данных») — НЕ оформлены в .sql файл,
#        Б.1 их завернёт
#   5. ПРОДОЛЖЕНИЕ ФАЗЫ РЭ.30 — начать с Б.1:
#
#      Б.1 SQL миграция глобальных пресетов на семантику.
#
#      Создать migrations/2026-05-21-presets-to-semantic.sql:
#      - UPDATE 7 глобальных пресетов с density=NULL,
#        student_layout_mode + параметры по mapping таблице
#        (см. spec §«Состояние данных»)
#      - UPDATE individual который ещё не мигрирован
#      - UPDATE spread_templates SET applies_to_configs='{}'
#        WHERE name LIKE 'E-%'
#
#      ⚠️ Применяется в Supabase отдельно (Сергей). Большая часть
#      UPDATE'ов уже применена 21.05.2026 — миграция идемпотентна,
#      приводит к согласованному финальному состоянию.
#
#      После Б.1 — контрольный тест (см. spec §«Контрольные тесты»).
#      После Б.1 коммита — переход к Б.2 (fix PresetEditorModal).
#
#      Дальше по плану spec'а: Б.3 cleanup → В.1 UI → В.2 UI →
#      В.3 UI → Г.1 summary.
#          в учительский раздел (где общие классные фото)?
#        • Что с виньетками класса — там должны быть только
#          заказавшие или все?
#        • Как мигрировать существующие альбомы (default true
#          разумно — все ученики в существующих альбомах считаем
#          заказавшими).
#      После согласования — план подэтапов и старт реализации.
#   6. План фаз после РЭ.25:
#      • РЭ.27 — print_type в АЛЬБОМЕ + режимы редактора (10-15 коммитов)
#      • РЭ.28 — партнёрские дизайны сценарий A (5-7 коммитов)
#      • РЭ.29+ — партнёрский IDML сценарий B, без даты

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
