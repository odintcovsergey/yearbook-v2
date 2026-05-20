# Фаза РЭ.22 — Конструктор пресетов с двух-осевой моделью

**Статус**: ✅ Закрыта
**Сроки**: 20.05.2026 (одна сессия от РЭ.22.0 до РЭ.22.10)
**Главная цель**: перевести engine с жёстких имён мастеров на семантический поиск через `page_role` + `slot_capacity`. Партнёр описывает структуру альбома параметрами (режим, числа), engine стыкует с библиотекой мастеров через теги.

## Что было до фазы

`buildFromSectionStructure` (РЭ.21) собирал альбомы через **жёсткие имена** мастеров:
- `E-Standard-Left/Right`, `E-Universal-Left/Right`, `E-Max-Left/Right` для students
- `F-Head-WithPhoto / SmallGrid / LargeGrid` + `G-FullClass / HalfClass / Teachers-3x3 / 4x3 / 4x4` для teachers
- `S-Intro`, `S-Final` для soft

Партнёр (= суперадмин в `/super/presets`) выбирал «комплектацию» (`density='standard'/'universal'/'medium'/...`) — engine разворачивал её в имена мастеров. Чтобы расширять/менять линейку — приходилось менять код.

Кроме того:
- Не было способа описать «1 ученик на разворот с 4 фото и цитатой» — была только запись в `density`, и под каждое значение жёсткое имя.
- Партнёр не мог создавать произвольные пресеты с произвольной сеткой (только 5 готовых density-вариантов).

## Что сделано

### 1. Двух-осевая модель личного раздела

Поле `presets.student_layout_mode` × `presets.student_grid_size`:

| mode | параметры | соответствие старым density |
|---|---|---|
| `page` | `student_friend_photos`, `student_has_quote` | Standard / Universal |
| `spread` | `student_friend_photos`, `student_has_quote` | Maximum / Individual |
| `grid` | `student_grid_size` (2..12), `student_has_quote` | Medium / Light / Mini |

Партнёр в UI выбирает «режим» и параметры под него. Старые поля (`student_pages_per_student`, `student_friend_photos`, `student_has_quote`) остались как DEPRECATED для обратной совместимости (legacy путь).

### 2. Engine — семантический поиск во всех 4 секциях

Engine больше не ищет жёсткие имена. Для каждого запроса формирует семантическую спецификацию (page_role + slot_capacity) и обходит template_set:

**students:**
- `mode='page'` → `findStudentMaster({pageRole: 'student_left'/'student_right', photos_friend, has_quote, has_portrait: true})` (РЭ.22.4)
- `mode='spread'` → две страницы: левая `photos_friend=0, has_portrait`, правая `photos_friend=N, has_quote` (РЭ.22.5)
- `mode='grid'` → `findStudentGridMaster({students: N, photos_full: 0, has_quote})` + combined-tail с `photos_full: 1` + adaptive-tail (min_fit) + null-padding fallback (РЭ.22.6)

**teachers** (РЭ.22.7.2):
- Левая: `findTeacherMaster({pageRole: 'teacher_left', head_teacher: 1, teachers: N, photos_full: 0})`
- Правая: `findTeacherMaster({pageRole: 'teacher_right', teachers: N OR photos_full: 1 OR photos_half: 2})`
- Таблица subjects 0/1-4/5-8/9/10-12/13-16/17+ сохранена, но имена → семантика

**soft** (РЭ.22.8.2):
- intro: `findSoftSectionMaster({pageRole: 'intro', photos_full: 1})`
- final: `findSoftSectionMaster({pageRole: 'final', photos_full: 1})`

Каждая секция имеет **legacy fallback по имени** для template_set'ов где мастера ещё не размечены тегами — обратная совместимость гарантирована.

В `decision_trace.inputs.semantic` пишется `true`/`false` чтобы было видно каким путём engine выбрал мастер.

### 3. Data-миграции: разметка существующих мастеров OkeyBook

Все мастера в БД OkeyBook размечены `page_role + slot_capacity`:

| Миграция | Затронуто |
|---|---|
| `2026-05-20-okeybook-grid-master-tags.sql` (РЭ.22.6.0) | M/L/N-Grid-Page, L-Grid-12, M/L/N-Combined-Page |
| `2026-05-20-okeybook-teacher-master-tags.sql` (РЭ.22.7.1) | F-Head-LargeGrid/SmallGrid/WithPhoto/WithClassPhoto-L, G-FullClass/HalfClass/Teachers-3x3/3x4/4x4 |
| `2026-05-20-okeybook-soft-master-tags.sql` (РЭ.22.8.1) | S-Intro, S-Final-Soft-L |

`slot_capacity` вычислялся **динамически** в SQL через `jsonb_array_elements(placeholders)` — числа не зашиты в миграции, считаются из реальных placeholder'ов мастеров. Это означает что миграция корректна для любых вариаций (если у мастера 5 portrait-слотов вместо 4, в slot_capacity тоже будет 5).

### 4. UI двух-осевой модели

В `app/super/presets/_components/PresetEditorModal.tsx` (РЭ.22.3):
- Главный селект «Режим» (page/spread/grid)
- Conditional параметры под селект
- Fallback `computeInitialLayoutMode` / `computeInitialGridSize` для legacy-записей (amber warning «нажмите Save для миграции в БД»)
- При Save пишутся новые поля + дублируются в legacy `student_pages_per_student` (для отката Vercel)

## Скрытые баги (4 штуки, все закрыты по ходу)

| # | Подэтап | Что | Когда обнаружен |
|---|---|---|---|
| 1 | РЭ.22.2 | `presetRowToPreset` в `loaders.ts` не пробрасывал `student_*` поля → `buildOnePerSpreadAdaptive` фактически не активировался в проде (тесты собирали Preset напрямую, минуя loader) | При проверке как новые поля прокидываются |
| 2 | РЭ.22.6 | Коллизия `L-Grid-12` vs `N-Grid-Page` (одинаковые теги `students=12`) | По выгрузке БД — оставлен (развилка D.1 spec'а) |
| 3 | РЭ.22.7.2 | Legacy искал `G-Teachers-4x3`, в БД мастер `G-Teachers-3x4`. Классы 10-12 предметниками в проде не получали правую страницу | По выгрузке teachers-мастеров — закрыт автоматически семантизацией (engine ищет `teachers=12`, имя не важно) |
| 4 | РЭ.22.8.1 fix | CHECK constraint `spread_templates_page_role_check` не содержал `'final'`. Транзакция миграции откатилась при первой попытке применения | При попытке Сергея применить миграцию — фикс в коммите 5187361 |

## Архитектурные развилки

Все 10 развилок зафиксированы в `docs/phase-Р22-spec.md §11`. Ключевые:

- **1A** — две новые колонки (`student_layout_mode + student_grid_size`), а не jsonb
- **2A** — legacy student_* поля помечены DEPRECATED, оставлены для отката
- **4** — `page_role='student_grid'` (нейтральный) принимается как fallback для `student_grid_left/right`
- **5A** — адаптивный хвост в grid через автопоиск семантикой, не явный список
- **6A** — `has_quote=true` только если quote-слотов столько же сколько portrait
- **7B** — `student_grid_size` свободный int 2..12 (не enum)
- **8** — диагностика — текстовая warning-строка (агрегацию JSON отложили)
- **9** — UI только в `/super/presets`, партнёрский `/app` — отдельная сессия
- **10** — порядок реализации: миграция БД → API → UI → engine

## Метрики

- **Коммитов на main**: 26 (12 feat-коммитов + 12 docs-контекстов + 1 fix + 1 spec)
- **Тестов**: 332 → 360 (+28 семантических тестов в 4 новых файлах)
- **Файлов миграций**: 4 (одна структурная + 3 data-миграции)
- **Кода добавлено**: ~3500 строк (включая контексты, без них ~600 строк продакшен-кода)
- **Регрессий**: 0 (все существующие тесты продолжали проходить после каждого подэтапа)

## Состояние после фазы

**Что работает прямо сейчас (legacy-путь):**
- 5 готовых пресетов OkeyBook продолжают собираться как раньше (`student_layout_mode=NULL` → engine идёт legacy путём через `density`/`preset.id`)
- Никаких изменений видимых для конечного пользователя
- Никаких регрессий

**Что включается при `student_layout_mode != NULL`:**
- Engine идёт семантическим путём
- Если партнёр откроет пресет в `/super/presets` и нажмёт Save — UI запишет `mode='page'/'spread'/'grid'` в БД, и при следующей сборке engine пойдёт семантикой
- Все мастера OkeyBook размечены (миграции применены), поэтому семантика всегда найдёт мастера

**Что НЕ сделано в фазе (намеренно):**
- РЭ.22.9 — диагностика недостающих мастеров. Заменена на следующую фазу **РЭ.23** («UI пресетов, управляемый template_set'ом») — Сергей предложил другую архитектуру: вместо «диагностики после выбора» — «прорастание template_set в форму», когда UI предлагает только те варианты, для которых есть мастера. Это отдельный большой подход, не подэтап.
- Удаление legacy полей `student_pages_per_student / friend_photos / has_quote` — отдельная сессия с двойным подтверждением необратимости.
- Удаление `presets.density` — отдельная сессия после того как все пресеты будут с `student_layout_mode != NULL`.

## Что дальше

1. **РЭ.23** — UI пресетов, управляемый template_set'ом (см. контекст v102 «Как начать»).
2. Эпизодически: когда дизайнер нарисует адаптивные мастера `L-2/3/4`, `N-4/6/9` — отдельная небольшая миграция чтобы их разметить.

## Файлы фазы

**Spec и summary:**
- `docs/phase-Р22-spec.md` — спецификация v1.0 (564 строки)
- `docs/phase-Р22-summary.md` — этот документ

**Миграции:**
- `migrations/2026-05-20-presets-student-layout-mode.sql` (РЭ.22.1)
- `migrations/2026-05-20-okeybook-grid-master-tags.sql` (РЭ.22.6.0)
- `migrations/2026-05-20-okeybook-teacher-master-tags.sql` (РЭ.22.7.1)
- `migrations/2026-05-20-okeybook-soft-master-tags.sql` (РЭ.22.8.1)

**Engine:**
- `lib/rule-engine/master-finder.ts` — `findStudentMaster`, `findStudentGridMaster`, `findTeacherMaster`, `findSoftSectionMaster`
- `lib/rule-engine/sections/students.ts` — `buildPageSemantic`, `buildSpreadSemantic`, `buildGridSemantic`
- `lib/rule-engine/sections/teachers.ts` — `pickLeftMaster`, `pickRightMaster` через `resolveTeacherMaster`
- `lib/rule-engine/sections/soft-intro.ts`, `soft-final.ts` — семантика + legacy fallback
- `lib/rule-engine/loaders.ts` — `presetRowToPreset` (попутно закрыт баг #1)

**API + UI:**
- `app/api/tenant/route.ts` — расширены `rule_presets_list` SELECT и `rule_preset_update` валидация
- `app/super/presets/_components/PresetEditorModal.tsx` — двух-осевая модель
- `lib/rule-engine/types.ts`, `lib/album-builder/types.ts` — типы Preset + PageRole

**Тесты (новые):**
- `sections-students-page-semantic.test.ts` (8 тестов)
- `sections-students-spread-semantic.test.ts` (7)
- `sections-students-grid-semantic.test.ts` (10)
- `sections-teachers-semantic.test.ts` (8)
- `sections-soft-semantic.test.ts` (11)
