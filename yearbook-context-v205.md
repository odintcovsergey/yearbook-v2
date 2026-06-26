# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v205
# Обновлено: 26.06.2026 (вечер) — РЭ.22.9: common/slot-chains переведены на семантику findCommonMaster
# HEAD: 53bc194 (main) на момент записи
#
# Предыдущий контекст: yearbook-context-v204.md (история не переписывается).

---

## 🆕 СЕССИЯ 26.06.2026 (вечер) — РЭ.22.9: common/slot-chains на семантику (by-name → by-type)

### ✅ DONE
- **РЭ.22.9 — выбор common-мастеров переведён с by-name на семантику** (релиз `53bc194`, live на проде,
  GitFlic подхватил, health 200/200). Было: `mastersByName.get('J-Half')` (по имени). Стало: новый
  **`lib/rule-engine/sections/find-common-master.ts` → `findCommonMaster(mastersByName, category, count,
  pageTypePref)`** — подбор по **`page_role='common'` + `slot_capacity` + `page_type`**, тем же паттерном,
  что уже работает у `findStudentMaster`/`findTeacherMaster`. Применён в `common.ts` в обоих режимах:
  ручной (`fillCommonSection`) и авто (`fillCommonAutoSection`/`pickAutopackPage`).
  - **Канон в движок НЕ тащили** (решение Сергея): `findCommonMaster` читает только role+capacity+page_type,
    итерирует существующий `mastersByName`. `master_page_types` движок по-прежнему не читает.
  - **Риск-точка лево/право воспроизведена** через `pageTypePref`-список: ручной quarter = `[сторона]`
    (как by-name skip, если стороны нет → null), авто quarter = `['page-any', сторона]` (preferAny раньше
    стороны), остальные = `['page-any']`. `is_spread`-мастера исключены (J-Spread не лезет в page-логику).
  - **ДОКАЗАТЕЛЬСТВО ИДЕНТИЧНОСТИ РАСКЛАДКИ** (28 сценариев на РЕАЛЬНЫХ мастерах прода, harness в
    scratchpad, до/после by-name vs by-type, сравнение по `master_id`):
    - **akvarel (полный канон): 14/14 ИДЕНТИЧНО** → на проде раскладка не меняется ни на пиксель.
    - **belly: 13/14.** Единственное расхождение `belly/auto/collage`: было `J-Collage-5`, стало
      `J-Collage-4` — **ОЖИДАЕМО И ПРАВИЛЬНО.** У belly `J-Collage-5` дефектный (`page_role=NULL`,
      не размечен): старый by-name брал его вслепую, новый by-type отбраковывает. **Чинится перезаливкой
      belly** (предусловие РЭ.22). Задокументировано в коммите `53bc194`.
  - **Тесты:** 32 падавших rule-engine-теста были by-name-фикстуры (синтетические common-мастера с
    `page_role=null`). По решению Сергея (Вариант A) **дотянуты до реальных мастеров** через новый
    `__fixtures__/common-master-fields.ts` → `commonMasterFields(name)`: J-Full→common/photos_full:1/page-any,
    J-Spread→full:1/spread/is_spread, J-Half→half:2/page-any, J-Quarter→quarter:2/page-any,
    J-Quarter-Left/-Right→page-left/right, J-Sixth-6→sixth:6, J-Collage-N→collage:N, не-J→null/null.
    5 фикстур правлены (sections-common-auto, sections-teachers, build-from-section-structure,
    sections-soft-and-pages, sections-students) + 1 ассерт warning'а (имя `J-Half` → тип `half_class`).
    `findCommonMaster` под тесты НЕ ослаблялся. **+9 юнитов** на `findCommonMaster`/`pageTypeFromName`.
  - **Гейты:** rule-engine **491** (было 482 + 9 новых), полный vitest **1232/1232**, tsc чисто, build зелёный.
  - **Границы:** students/teachers/soft/transition/legacy `buildGrid`/алгоритм распределения/хвоста —
    НЕ тронуты.

### 🚩 ЧТО ДАЛЬШЕ / хвосты (НЕ горит)
- **РЭ.22 продолжается** (by-name → by-type, тем же паттерном, КАЖДЫЙ подэтап со сверкой раскладки до/после
  N=13/25/30 × density × akvarel/belly; канон в движок НЕ тащить):
  - **РЭ.22.10 — transition.** Главная риск-точка лево/право (стороны схлопываются в page_type, селектор
    обязан воспроизвести side-логику). Отдельным заходом.
  - **РЭ.22.11 — legacy `buildGrid`.** Сначала ПРОВЕРИТЬ, живы ли пресеты `mode=null` — возможно, путь
    мёртвый и идёт сразу в удаление, а не в перевод.
  - **РЭ.22.12 — уборка** legacy-fallback-имён.
  - **Предусловие боевого на belly:** перезалить belly (2 NULL-мастера `J-Collage-5` /
    `J-J-Combined-Tail-2-Right` получат разметку role/capacity, чинится опечатка `J-J-`).
- **Потом Фаза 3** — структура как объект (`audit-phase3-structure.md`: гибрид — фикс. порядок
  `section_structure` + адаптивное наполнение кодом; РЭ.22 — её предусловие, чтобы отвязать от имён
  мастеров). Затем **Фаза 4** (дизайн↔структура m:m + расщепление placeholder), **Фаза 5** (UI «Дизайны»
  + диалог добавления типа в канон + панель slug-валидации), **Фаза 6** (уборка дублирующих полей
  spread_templates).
- **Хвост: полная типовая чистка legacy (Вариант B)** — удалить поля/типы `RuleEngineBundle.rules/.families`,
  `Rule`, `TemplateFamily`, `Preset.sections` + переписать ~25 тест-фикстур. Отложено **НА ПОСЛЕ РЭ.22**
  (сейчас заглушки, чтобы не трогать тесты раскладки в разгар РЭ.22).
- **Проекты/доки:** `tz-re22-binding.md`, `tz-phase2-canon-match.md`, `tz-master-library-schema.md`,
  `tz-struct-design-split.md` (v2).
- **Оживить TTL-чистку exports/delivery.** `/api/cleanup` — НЕ мёртвый, а ОТКЛЮЧЁННЫЙ чистильщик истёкших
  `album_exports`/`delivery_files` (по `expires_at`). Чистит ДРУГОЕ, чем systemd `yearbook-cleanup`
  (тот — `photos.original_path` архивов). Предпочтительно: вынести в скрипт по образцу `archive-cleanup.mts`
  + таймер. **НЕ удалять `/api/cleanup`.** Завести карточку в Notion.
- **2 дефектных belly-мастера** (`J-Collage-5`, `J-J-Combined-Tail-2-Right`: null role/capacity + опечатка
  `J-J-`) — выправить при перезаливке belly (см. предусловие РЭ.22 выше).
- **Мелкий UX-хвост:** форма загрузки IDML показывает ошибку slug-валидации при заглавных буквах неочевидно.
  Live-подсказку под полем / авто-нижний-регистр. (Решится в т.ч. Фазой 5.)

---

## История сессии 26.06.2026 (день) — отказоустойчивый деплой (GitFlic-primary) + аудит legacy + Фазы 1-2 канона

### ✅ DONE
- **Аудит legacy-хвостов после переезда на Timeweb** (`audit-legacy-tails.md`):
  живых путей данных мимо Timeweb — **0**, всё gated на `STORAGE_BACKEND=timeweb`.
- **feat: fail-fast барьер на `STORAGE_BACKEND`** (`instrumentation.ts` +
  `lib/config/assert-storage-backend.ts` + 8 юнит-тестов). В production при значении
  ≠ `timeweb` сервер 500-ит ВСЁ + FATAL в логе → health-check деплоя откатывает релиз.
  Выкачено `d9044ba`, live, health 200/200, 0 FATAL. Дефолт `'supabase'` не менялся.
- **chore: гигиена** (`7a7ff2b`) — удалён мёртвый `images.remotePatterns`, 5 one-off
  скриптов переезда, `.env.example` приведён к Timeweb-реальности.
- **docs** (`7bf79f9`) — уточнение в `audit-legacy-tails.md` про `/api/cleanup`.
- **ci: отказоустойчивый выбор источника деплоя — primary GitFlic, fallback GitHub**
  (`afbaff8`). `select-source.sh` (`DEPLOY_REMOTES="gitflic origin"`, первый ответивший на
  `ls-remote --exit-code` → активный) + `prepare-repo.sh` + `deploy.sh` (`$ACTIVE_REMOTE`) +
  `yearbook-deploy.service`. Боевой-проверено, fallback доказан симуляцией. Откат:
  `yearbook-deploy.service.bak-pre-gitflic` + revert afbaff8.
- **Read-доступ сервера к GitFlic.** Remote `gitflic` + oauth2-токен read-only в
  `/srv/yearbook/.git-credentials` (600). GitFlic из РФ стабилен, GitHub флапает по SSL.
- **feat: Библиотека мастер-страниц, Фаза 1.** Таблица **`master_page_types`** (канон типов:
  `code, display_name, family_id, page_role, slot_capacity, canonical_slots, page_type, is_active,
  notes`) + nullable **`spread_templates.master_page_type_id`**. Наполнение: 41 тип, легло
  59/61 мастеров (akvarel 24/24, belly 35/37). Канон «для чтения» — движок/редактор/экспорт
  `type_id` НЕ читают. Коммит `f1ece1b`. Опора: `audit-master-library-phase0.md`.
- **Подтверждено на данных:** матч мастера с типом идёт по **role+capacity, НЕ по label** →
  Вариант Б (виртуальный разрез через семантические теги) работает.
- **feat: Фаза 2 — сверка дизайна с каноном при загрузке IDML** (`c920040` live). Мягкий режим
  (распознаёт + отчёт, НЕ блокирует). `lib/idml-converter/canon-match.ts` → `matchCanonType` по
  role+capacity (+ разводка common full/spread по page_type) — единый источник логики с backfill
  Фазы 1; +11 юнитов. Панель результата в `UploadModal`. Parity с Фазой 1: 61/61. Боевая проба:
  akvarel перезалит → «Распознано 24 из 24 ✓».
- **chore: уборка мёртвого legacy-движка `buildFromRules`.** Этап А (код, `193944e`): убраны
  мёртвые SELECT'ы `rules`/`template_families` в `loaders.ts` + запись `presets.sections`. Вариант A
  — типы-заглушки оставлены (25 фикстур не тронуты). Этап Б (SQL, `a1deec0`): DROP таблицы `rules`,
  колонки `template_families.density_config` (ТАБЛИЦА жива — FK), колонки `presets.sections`.
  Побочно ПОЧИНЕН регресс: `presets.sections` был NOT NULL без default → создание нового пресета
  падало → DROP восстановил. rule-engine 482/482, vitest 1223/1223.
- 🎓 **УРОК:** убирая запись в КОЛОНКУ перед её DROP — заранее проверить `NOT NULL`/`default`,
  иначе окно сломанного прода между «код доехал» и «SQL DROP».

---

## Что делали (историческое — ТЗ адаптации формата, 19.06.2026)

ТЗ «адаптация макета под формат типографии (Format-модель) — превью». Заказ хранит
`format_id`, но рендер брал размеры из мастера IDML. Добавили равномерное (uniform)
масштабирование дизайна под формат заказа в ПРЕВЬЮ и РЕДАКТОРЕ разворотов.

**Границы ТЗ:** финальный экспорт-рендер (PDF/JPG) — отдельное ТЗ. Растяжение (stretch)
не делаем. Между семействами (квадрат↔прямоугольник) не адаптируем — предупреждаем.

## Решения
- Адаптация только uniform-scale, по меньшему коэффициенту work-зоны, контент центрируется.
  Фон рисует холст во всю страницу (навылет).
- Адаптация только ВНУТРИ одного семейства пропорций.
- Архитектура: адаптируем сам мастер (размеры + плейсхолдеры) ОДНИМ чистым преобразованием
  перед подачей в холст (как layoutCover у обложки).

## ✅ DONE (развороты)
1. **Семейство дизайна `format_family`** — миграция (nullable, CHECK), типы TemplateSet, API,
   карточка дизайна + FormatFamilyModal.
2. **Ядро `lib/format-adapt/`** (+10 тестов): `computeFormatFamily`, `resolveDesignFamily`,
   `resolveFormat`, `adaptTemplateToFormat` → `{status:native|incompatible|adapted, scale, warning?}`.
3. **Превью** (LayoutPreviewStrip) — `targetFormat`, адаптация мастеров, отступ корешка, плашка.
4. **Редактор разворотов** — designSource + targetFormat, главный холст/полоса/«Вид» на
   адаптированных мастерах. Формат не выбран → родной формат.

## 🚩 ОСТАЛОСЬ В ТЗ адаптации
- **ОБЛОЖКА** (превью + редактор) — отдельная система рендера, нужна своя математика масштаба
  (корешок между страницами не масштабируется форматом). Отдельным шагом.

## Что НЕ трогали
- Engine-раскладку, страницы родителей, экспорт/таймаут. Сохранение данных/кроп — на оригинальных
  координатах (адаптация только для отображения).
