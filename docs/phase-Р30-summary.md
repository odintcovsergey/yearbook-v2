# Фаза РЭ.30 — Чистка путей сборки альбома

**Статус**: ✅ Закрыта
**Сроки**: 21.05.2026 (одна сессия от РЭ.30.A диагностики до Г.1 закрытия)
**Главная цель**: убрать «винегрет» из трёх параллельных путей задания структуры альбома. Оставить **один путь** — выбор Шаблона из каталога в форме альбома.

## Что было до фазы

После РЭ.22 (семантический движок), РЭ.24 (каталог шаблонов) и РЭ.27 (`print_type` в альбоме) — в форме альбома и в обзоре одновременно жили **три способа** задать как собрать:

1. **Шаблон из каталога** (`section_structure_preset_id`) — новый путь через `buildFromSectionStructure` + семантический поиск мастеров.
2. **Комплектация + Тип печати** (`config_preset_id`) — legacy-путь через `buildAlbum` + жёсткие имена мастеров.
3. **Селект «Section Structure»** в обзоре альбома — захардкоженные 7 строковых ID (`standard`, `universal`, `maximum`, `individual`, `medium`, `light`, `mini-soft`) с тем же `section_structure_preset_id`, но альтернативный UI.

Партнёр видел все три, не понимал приоритета. В редакторе шаблона (`PresetEditorModal`) при сохранении одновременно записывались `density` И `student_layout_mode` — получались **смешанные пресеты** с непредсказуемым поведением engine'а.

Диагностика фазы (`docs/phase-Р30-diagnostic.md`, commit `fe3ce67`) показала: проблема **не в коде engine** — `buildFromSectionStructure` рабочий, `findTeacherMaster` / `findStudentMaster` работают. Проблема в **данных и UI**:

- Все **7 глобальных пресетов** OkeyBook жили на legacy-модели (`density` заполнен, `student_layout_mode=NULL`) → engine для них обязан был идти legacy-путём.
- **2 партнёрских пресета** Сергея были смешанными (`blank-w7lygmuy`, `custom-l34kwu6p` — заполнены оба поля).
- **UI редактора** позволял писать density при сохранении.
- **UI формы альбома** показывал альтернативные селекты «Комплектация + Тип печати».
- **UI обзора** показывал лишний селект «Section Structure».

## Что сделано

### Этап Б — миграция данных (3 коммита)

#### Б.1 — SQL миграция глобальных пресетов на семантику (commit `2992821`)

`migrations/2026-05-21-presets-to-semantic.sql`:

- 7 UPDATE'ов по `id + tenant_id IS NULL` для каждого глобального пресета:
  - `density = NULL`, `sheet_type = NULL`
  - `student_layout_mode` + параметры по mapping таблице
  - `template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')`
- 1 UPDATE для E-* мастеров: `applies_to_configs = ARRAY[]::text[]` (legacy-поле, не нужно при семантическом поиске).

Mapping:

| id | mode | grid_size | friends | quote |
|---|---|---|---|---|
| standard | page | — | 0 | true |
| universal | page | — | 2 | true |
| maximum | spread | — | 4 | true |
| individual | spread | — | 4 | true |
| medium | grid | 4 | — | true |
| light | grid | 6 | — | false |
| mini-soft | grid | 12 | — | false |

Идемпотентно (WHERE по id, повторное применение безопасно). Применена в Supabase 21.05.2026. Проверка `SELECT id, density, student_layout_mode FROM presets WHERE tenant_id IS NULL`: `density=NULL` у всех 7, `student_layout_mode` заполнен.

#### Б.2 — PresetEditorModal не пишет density/sheet_type (commit `73cd5ed`)

`app/super/presets/_components/PresetEditorModal.tsx` — из body патча `rule_preset_update` убраны ключи `density` и `sheet_type`. API делает partial update: отсутствие ключа в body означает «не трогать значение в БД». Существующие legacy-пресеты остаются как были, новые сохранения не создают смешанных записей.

State и UI селекты Б.2 не трогает — удалены в В.2.

#### Б.3 — SQL миграция cleanup смешанных пресетов (commit `bb0d7f9`)

`migrations/2026-05-21-presets-cleanup-mixed.sql`:

```sql
UPDATE presets
SET density = NULL, sheet_type = NULL
WHERE student_layout_mode IS NOT NULL
  AND (density IS NOT NULL OR sheet_type IS NOT NULL);
```

Затронула только 2 партнёрских смешанных пресета. Чистые legacy (только `density`) и чистые семантические (только `layout_mode`) не задеты. Применена в Supabase 21.05.2026. Проверка `mixed_remaining`: 0.

### Этап В — чистка UI (3 коммита)

#### В.1 — селект Section Structure из обзора (commit `4455a8b`)

`app/app/page.tsx` — удалена функция `SectionStructurePresetControl` (≈90 строк: захардкоженная константа `SS_PRESETS`, локальный state, обработчики) и место её вызова в обзоре альбома. На месте — комментарий-маркер РЭ.30.4.

Размер diff'а: `-102 / +12`. Поле `albums.section_structure_preset_id` в БД сохранено — заполняется через виджет «Шаблон» в форме альбома.

#### В.2 — поля «Плотность портретов» и «Тип листов» из редактора (commit `1bc8d76`)

`app/super/presets/_components/PresetEditorModal.tsx`:

- Удалены селекты «Плотность портретов» (5 опций) и «Тип листов» (hard/soft).
- Удалены state `density`/`setDensity`, `sheetType`/`setSheetType`.
- Упрощены initial-хелперы: `computeInitialLayoutMode` возвращает `student_layout_mode ?? 'page'`, `computeInitialGridSize` — `student_grid_size ?? 4`. Раньше fallback'или по `density / preset.id` — после Б.1 это не нужно.
- Amber-warning «Режим вычислен из density» переформулирован.

После В.2 редактор показывает только семантические параметры: Режим + grid_size/friends + has_quote.

#### В.3 — блок «Комплектация + Тип печати» из формы альбома (commit `74438d4`)

`app/app/page.tsx`:

- Удалён JSX-блок «Пресет вёрстки» (≈70 строк): селекты «Комплектация» (`config_type`) + «Тип печати» (`print_type`) и amber-подсказка.
- Удалён state `presets`/`setPresets` и `useEffect` загрузки `presets_list`.
- Submit-логика упрощена: ветка с `preset_slug` для legacy убрана. Новые альбомы отправляют либо `section_structure_preset_id`, либо ничего.
- Два amber-warning'а в обзоре и tooltip кнопки «Пересобрать» переформулированы — больше не упоминают «Комплектация».

После В.3 в форме альбома единственный способ задать сборку — виджет «Шаблон» (РЭ.24).

### Этап Г — закрытие фазы

#### Г.1 — Summary + контекст v150

`docs/phase-Р30-summary.md` (этот файл) + `yearbook-context-v150.md` с пометкой «🎉 ФАЗА РЭ.30 ЗАКРЫТА».

## Архитектурное решение

**Один путь к сборке альбома = выбор Шаблона в каталоге.**

```
Партнёр → /app/templates/[designId]
      → видит «Готовые от OkeyBook» и «Мои шаблоны»
      → создаёт свой через «+ Создать свой шаблон» (Режим + параметры + секции)
      → выбирает шаблон в форме альбома (виджет «Шаблон»)
      → albums.section_structure_preset_id = id выбранного preset'а
      → buildFromSectionStructure(preset, ...) собирает альбом семантически
```

Никаких альтернативных селектов («Комплектация», «Section Structure»), никаких полей которые писались в скрытые legacy-колонки.

Поле `albums.config_preset_id` в БД **сохранено** — 12 legacy-альбомов на продакшне продолжают использовать его через старый движок `buildAlbum`. Новые альбомы её не заполняют. Удаление колонки — отдельной фазой когда уйдут с прода.

## Применение урока РЭ.27

В РЭ.27 был эпизод где разработка опиралась на ментальную модель схемы БД вместо реальной. Лекарство — снимать реальное состояние БД через `information_schema` или прямые SELECT'ы перед каждой миграцией.

В РЭ.30 правило применено:

1. **Перед Б.1**: получены реальные данные от Сергея — `SELECT id, density, student_layout_mode, ...` показал что 6 из 7 глобальных пресетов УЖЕ мигрированы вручную, и только `individual` нет. Это изменило тактику: миграция написана как «sync to known state» (UPDATE'ы по id с явным значением всех полей), а не как «migrate from current to target».
2. **Перед Б.3**: проверка через выгрузку, что осталось только 2 смешанных пресета — не пытались мигрировать «все density на NULL у всех» (это сломало бы legacy-пресеты).
3. **Перед В.3**: `grep config_preset_id` показал что поле используется и в типах, и в submit-логике — нельзя удалять колонку, только перестать писать.

Никаких новых «открытий» в фазе. Никаких откатов миграций.

## Что НЕ сделано (фиксируется как долг)

1. **Общий раздел (`common_required`)** не собирается семантически — партнёр добавляет страницы вручную через J-* мастера в редакторе. Не блокер фазы (по решению Сергея №6 в spec'е). Открытая задача: семантический поиск J-* мастеров по `slot_capacity.photos_full / photos_half / photos_quarter / photos_sixth`.

2. **Удаление колонок из БД**: `presets.density`, `presets.sheet_type`, `config_presets.print_type`, `albums.config_preset_id`. Используются 12 legacy-альбомами на продакшне. Удаление — отдельной фазой когда уйдут.

3. **Удаление legacy движка `buildAlbum`**. Те же 12 альбомов на нём держатся. Отдельной фазой.

4. **State `form.config_type` и `form.print_type` в `AlbumFormModal`** — формально стали dead state после В.3 (submit-логика их не использует). Не удалены чтобы не разрастать diff'ы фазы. Тоже отдельной задачей при следующей правке формы.

5. **Партнёрский `cover_preview_url` у клонов template_set** — долг РЭ.28, не задача этой фазы.

## Статистика фазы

- **Коммитов основной фазы: 7** — `2992821..74438d4` + текущий summary.
- **Контекстных коммитов: 8** — v143..v150.
- **SQL миграций: 2** — `presets-to-semantic.sql` (Б.1), `presets-cleanup-mixed.sql` (Б.3). Обе применены в Supabase.
- **Новых unit-тестов: 0** — фаза целиком про данные и UI, всё через ручную проверку в браузере.
- **Затронуто файлов кода: 2** — `app/app/page.tsx`, `app/super/presets/_components/PresetEditorModal.tsx`.
- **Длительность:** одна сессия (21.05.2026). После закрытия РЭ.28 и РЭ.27 в той же сессии.

## Ключевые файлы фазы

**SQL миграции:**
- `migrations/2026-05-21-presets-to-semantic.sql` — Б.1, 7 UPDATE'ов глобальных пресетов + applies_to_configs.
- `migrations/2026-05-21-presets-cleanup-mixed.sql` — Б.3, cleanup смешанных.

**Код:**
- `app/super/presets/_components/PresetEditorModal.tsx` — Б.2 (не писать density) + В.2 (убрать селекты).
- `app/app/page.tsx` — В.1 (убрать селект Section Structure из обзора) + В.3 (убрать блок Комплектация+Тип печати из формы).

**Документация:**
- `docs/phase-Р30-spec.md` — spec фазы (283 строки, commit `8d5b996`).
- `docs/phase-Р30-diagnostic.md` — диагностика (commit `fe3ce67`).
- `docs/phase-Р30-summary.md` — этот файл.

## Связь со следующими фазами

**Очистка legacy в БД** — отдельная фаза в будущем когда 12 legacy-альбомов уйдут с прода. Колонки `density`, `sheet_type`, `config_preset_id` и движок `buildAlbum` исчезнут одним пакетом.

**Семантический общий раздел** — следующий логичный шаг. После РЭ.30 личный раздел и учительский собираются семантически по `slot_capacity`, общий — нет. По мере появления партнёров с собственными J-* мастерами потребуется ровно тот же подход (find by photos_full/half/quarter/sixth).

**Партнёрские дизайны (РЭ.29 — сценарий B, IDML с нуля)** — открывается по запросу первого партнёра с собственным IDML.

---

**Конец summary РЭ.30. Винегрет убран. Один Шаблон — одна сборка.**
