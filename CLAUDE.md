# CLAUDE.md — рабочий гайд для Claude Code

Платформа для школьных фотографов: от сбора фото у родителей до автовёрстки альбома и экспорта в PDF. Свежий контекст всегда в `yearbook-context-v<N>.md` (последний на момент создания этого файла — `v178`, 27.05.2026). Этот документ — компактная выжимка для ежедневной работы, история остаётся в context-файлах.

---

## Как общаться с Сергеем

- **Сергей не программист.** Объяснять простыми словами, без жаргона. Если без термина никак — расшифровывать в скобках. Думать как продакт-менеджер, объясняющий разработчику, а не наоборот.
- **Сергей диктует на микрофон.** Речь разговорная и неточная: окончания, падежи, термины могут плыть. Понимать смысл, не цепляться к словам. Если правда непонятно — переспросить одной короткой фразой, не списком уточняющих вопросов.
- **Сергей мыслит продуктом и пользователем,** а не кодом. Когда он описывает задачу через сценарий («партнёр кликает на фото и хочет…») — это и есть ТЗ. Переводить в код самому, не требовать технических деталей.
- **Перед каждым коммитом** объяснять простыми словами что сделано и зачем, и **спрашивать подтверждение**. Никогда не коммитить молча. После OK — коммитим, потом снова ждём OK на push.
- **Риски объяснять простым языком:** что может сломаться, кого это затронет, можно ли откатить. Не «может возникнуть race condition» — а «если два родителя одновременно нажмут — кто-то увидит чужое фото».
- **Не делать вид, что работает, если не уверен.** Лучше честно: «я это написал, но не проверил в браузере», «тесты зелёные, но руками я этот сценарий не прокликал», «миграцию написал, но на реальных данных не пробовал». Не подменять реальную проверку зелёными тестами.
- **SQL для Supabase** — всегда писать с **префиксами таблиц** в JOIN и WHERE (`albums.id`, `spread_templates.template_set_id`), даже когда поле уникальное. Это спасает от ошибки `column reference is ambiguous`, которая стреляет при первом же join'е с одноимёнными колонками.

---

## Стек

- **Frontend/Server:** Next.js 14.2 (App Router), React 18, TypeScript 5
- **БД и Storage:** Supabase (Postgres + Storage bucket `photos`); все миграции применяет Сергей вручную через Supabase Studio → SQL Editor
- **Canvas-редактор:** Konva 10 + react-konva
- **PDF-экспорт:** pdf-lib + @pdf-lib/fontkit, sharp для изображений
- **IDML-парсинг:** fast-xml-parser (с `preserveOrder=true` для текста)
- **Drag&drop:** @dnd-kit
- **S3 (Yandex Cloud):** @aws-sdk/client-s3 + presigner
- **Стили:** Tailwind 3
- **Тесты:** Vitest 4 (758/758 passed)
- **Деплой:** Vercel (auto-deploy на push в main)

---

## Структура

```
app/
├── api/               Next API routes: tenant, album, layout, upload, workflow, super…
├── app/               Партнёрский UI (редактор, каталог мастеров, шаблоны)
│   ├── _components/   Канвас, панели, модалки (TextStylePanel, PhotoPalette, ExportPanel…)
│   └── album/[id]/layout/  Редактор разворотов альбома
├── super/             Супер-админ UI (мастера, пресеты, шаблоны)
└── [token]/           Родительский вход по уникальной ссылке

lib/
├── album-builder/     Сборка альбома из учеников + мастеров (types, utils, scenarios)
├── rule-engine/       Правила секций (students, teachers, common, soft-intro/final)
├── idml-converter/    Парсер IDML → spread_templates (extract-geometry, extract-styles, family-mapping, upload)
├── smart-fill/        build-album-input (вход для билдера)
├── pdf-export/        pipeline + font-loader + text-shaping + photo-embed
├── photo-transform/   Кадрирование / трансформации фото
├── text-style/        fonts.ts (curated 7 семейств), groups.ts (глобальные стили)
├── balance-overrides/ Движок балансировки сеток
├── presets/           Пресеты конфигурации (mini/light/medium/maximum/individual)
├── template-set-clone/  Клонирование template_set
├── template-replace/  Замена мастеров
├── api-client.ts      Клиент tenant API
├── auth.ts            JWT-куки (cookie name: auth_token)
└── supabase.ts        Supabase client factory

migrations/            Датированные SQL миграции (2026-MM-DD-*.sql)
docs/                  Спеки, ТЗ дизайнеру, диагностики, rule-engine data
public/fonts/          12 TTF (7 семейств: Noto Serif, PT Serif, Open Sans, Roboto, Montserrat, Caveat, Slimamif)
schema.sql             Стартовая схема для нового проекта Supabase
```

---

## Команды

```bash
npm run dev              # localhost:3000 (Next dev)
npm run build            # next build
npm test                 # vitest run (одноразово)
npm run test:watch       # vitest watch
npx tsc --noEmit         # проверка типов
npx next build           # билд (полный pipeline)
```

### Wait-loop для dev-сервера (smoke-тесты)

Запуск в фоне + `until grep -q "Ready in" /tmp/yearbook-dev.log` с timeout 60s. Cookie для curl — `auth_token=$JWT` (не `access_token`).

---

## Правила коммитов

**Перед каждым коммитом обязательно:**
1. `npx vitest run` → 758/758 (или сколько на сейчас) passed
2. `npx tsc --noEmit` → пусто
3. `npx next build` → зелёный

Если что-то падает — фиксим, не коммитим.

**Формат сообщения:** русский, короткий, с этапом (например `feat РЭ.59: категория common_collage` / `fix РЭ.58: парсер заполняет page_role+slot_capacity`). Heredoc `<<'EOF'` для многострочных — без экранирования кавычек.

**Авторство:** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

**Push:** только по явному OK Сергея. Не объединять `commit && push`. Между ними — ждать.

**Не амендить** уже опубликованные коммиты. Новый коммит — лучше.

**.gitignore-нюанс:** `tsconfig.tsbuildinfo` сейчас в репо, но это generated TS-кэш — при конфликтах с pull брать `--theirs` или stash.

---

## Workflow

- **Документы для Сергея** показывать через `cat` в чат (не открывать редактор/preview).
- **Миграции:** пишем датированный SQL в `migrations/`, в чате выдаём текст для Supabase Studio. Сергей применяет вручную и сообщает результат.
- **`.env.local`** — если временно подменяли заглушками (например, для CI/тестов сборки) — **обязательно** вернуть настоящий ДО операций с БД.
- **IDML force=true upload** ломает привязки альбомов к мастерам (template_id меняется при DELETE+INSERT). В тесте — ок, в проде — versioning через новые slug.

---

## Жёсткие правила кода (из feedback-памяти)

- **Никогда не глушить unused import через `void name`.** Не используется — удалить.
- **`Write` упал дважды с жалобой на дубли** → fallback на `cat <<'EOF' > file` + `wc -l` / `grep` для верификации.
- **Supabase query builder с условными фильтрами:** `let q; q = q.or(...)`, не `const q; q.or(...)` — иначе immutability обманывает (потенциальный security-bug в `/api/tenant`, требует отдельной проверки).
- **`font-display`** прокидывается только через inline style: `style={{fontFamily: 'var(--font-display)'}}`. 6 use-сайтов, не менять без миграции всех.
- **PostgREST nested aggregate** `select('foo(count)')` → `foo: [{count: number}]` (массив с объектом, не число).
- **`photo_locks.expires_at` TTL** — read: `.gt('expires_at', now)`; upsert: явно `now + 15min`.
- **Heredoc `<<'EOF'`** — литеральный: писать кавычки как есть, без `\"`.

---

## Текущее состояние (на v178, 27.05.2026)

- ✅ Все 30 мастеров ТЗ v1.5 нарисованы в IDML + загружены в БД (template_set `okeybook-default`, layflat 226×288 мм)
- ✅ +6 J-Combined-Tail-* стабов (только Tail-4 нарисован, остальные ждут IDML)
- ✅ Декоративный текст из IDML через Script Labels (`default_text` в placeholder)
- ✅ Personal section собирается корректно (page_role/slot_capacity заполняются парсером)
- ✅ Глобальные стили текстов (4 группы: studentname/studentquote/teachername/teacherrole) — size/color/halign/valign/font_family
- ✅ Точечные override'ы стилей через TextStylePanel
- ✅ 7 curated шрифтов выбираются партнёром (см. lib/text-style/fonts.ts)
- ✅ Канвас учитывает rotation_deg (вертикальный «Классный руководитель»)
- ✅ Категория `common_collage` (партнёр загружает, билдер пока НЕ использует)
- ✅ Тесты: 758/758, tsc чистый, next build зелёный

### Что ждёт IDML от Сергея

- **N-Grid-Page-9** (3×3 ровный) — нарисован, ждёт загрузки + family-mapping (~30-45 мин кода)
- **5 J-Combined-Tail мастеров:** Tail-2 / Tail-2-Right / Tail-3 / Tail-3-Right / Tail-4-Right (family-mapping уже готов из РЭ.58)
- **J-Collage-3/5/7/8** — после кода для `common_collage` интеграции (~3-4 часа)

### Большие отложенные задачи

1. **PDF-export глобальных стилей и шрифтов** — pipeline пока НЕ применяет ни одного override (size/color/halign/valign/font). Сергей сам отложил до серьёзной работы с PDF.
2. **Адаптация под форматы типографий** — гибридная стратегия (D — фрейминг, E — анизотропное по одной оси) описана в v178. Делать когда появится вторая типография.
3. **AI-помощник для партнёров** — большой отдельный проект.

---

## Что НЕ трогать

- **`lib/balance-overrides/`** — рабочий код движка, не путать со снесёнными `app/super/balance-prototype/*`.
- **`page_role` / `slot_capacity` / `applies_to_configs`** заполняются ТОЛЬКО из `lib/idml-converter/family-mapping.ts`. Если меняется структура мастера (например, добавляем фото с друзьями в E-Standard-Left) — обновлять mapping, иначе фильтр в `findStudentMaster` не пропустит мастер.
- **`lib/text-style/fonts.ts AVAILABLE_FONTS`** — single source of truth. Добавить шрифт = синхронно в 4 местах: `public/fonts/*.ttf`, `app/globals.css` (@font-face), `lib/pdf-export/font-loader.ts` (FontKey + FONT_FILES + resolveKey), `AVAILABLE_FONTS`.
- **`tsconfig.tsbuildinfo`** — generated, не редактировать.
- **Старые контекст-файлы (`yearbook-context-v*.md`)** — историю не переписываем.
- **`schema.sql`** — стартовая схема для нового Supabase-проекта. Изменения в схеме идут отдельным файлом в `migrations/`, в schema.sql дублируем только когда нужно для нового деплоя с нуля.

---

## Ключевые файлы / точки входа

| Зачем | Файл |
|---|---|
| Сборка альбома (вход) | `lib/smart-fill/build-album-input.ts` |
| Билдер альбома | `lib/album-builder/` (types.ts, utils.ts, SCENARIOS) |
| Движок секций | `lib/rule-engine/sections/{students,teachers,common,soft-intro,soft-final}.ts` |
| Поиск мастеров | `lib/rule-engine/students.ts` (findStudentMaster, findStudentGridMaster) |
| Парсер IDML | `lib/idml-converter/{extract-geometry,extract-styles,family-mapping,upload}.ts` |
| Канвас редактора | `app/app/_components/AlbumSpreadCanvas.tsx` (Konva) |
| Палитра фото | `app/app/_components/PhotoPalette.tsx` (8 категорий + табы) |
| Панель стиля текста | `app/app/_components/TextStylePanel.tsx` (точечный override, smart-position) |
| Модалка глобальных стилей | `app/app/_components/AlbumTextStylesModal.tsx` |
| Редактор альбома | `app/app/album/[id]/layout/page.tsx` |
| API tenant (CRUD альбомов и т.п.) | `app/api/tenant/route.ts` |
| PDF pipeline | `lib/pdf-export/pipeline.ts` |
| Font loader (PDF) | `lib/pdf-export/font-loader.ts` |
| Каскад font_family | `lib/text-style/fonts.ts` (resolveFontFamily) |
| Каскад size/color/halign/valign | `lib/text-style/groups.ts` (resolveFontSizeMult / resolveColor / resolveHAlign / resolveVAlign) |
| Каталог мастеров (доки) | `docs/templates/designer-tz-2026-05-16-v1.5.md` |

---

## Терминология

- **Мастер (master / spread_template):** прототип страницы/разворота в IDML. У него `page_role` (`student_left/right/grid`, `teacher_left/right`, `common`, `intro`, `final`) и `slot_capacity` (сколько учеников, фото, есть ли портрет/имя/цитата).
- **Семья мастеров (family):** группа мастеров одного предназначения (E-Universal, M-Grid-Page, J-Combined-Tail-*). Маппинг в `family-mapping.ts`.
- **Placeholder:** именованный слот в мастере (Script Label из IDML). Канонические имена: `studentportrait_N`, `studentname_N`, `studentquote`, `headtextframe`, `headteachername`, `headteacherrole`, `teachername_N`, `teacherrole_N`, `classphotoframe`, `quarterphoto_N`, `sixthphoto_N`. Произвольные имена (например `static_text_1`) трактуются как декоративный текст с `default_text`.
- **Категории фото:** `portrait`, `group`, `teacher`, `common_spread`, `common_full`, `common_half`, `common_quarter`, `common_sixth`, `common_collage`.
- **Distribution «Жадно»:** заполняем класс по симметризации, например 25 учеников / Mini12 → 12+11+2 (а не 12+12+1).
- **РЭ.NN:** номер этапа Rule Engine (РЭ.59 = категория common_collage, РЭ.58 = парсер заполняет legacy-поля, и т.д.).

---

## Если что-то непонятно

1. Свежая выжимка состояния — последний `yearbook-context-v*.md` (сейчас `v178`, дата в шапке).
2. Полная история этапов — context-файлы по нисходящей: каждый новый ссылается на предыдущий.
3. Документы дизайнеру и ТЗ — `docs/templates/`, `docs/phase-*-spec.md`, `docs/designer-*.md`.
4. Каталог мастеров — `docs/templates/designer-tz-2026-05-16-v1.5.md`.
5. Спрашивать у Сергея, когда продуктовое решение не зафиксировано в context-файлах.
