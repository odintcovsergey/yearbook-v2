# Фаза 0.5 — Refactor builder под гибкий конструктор пресетов

> Документ создан 07.05.2026 после обнаружения архитектурного пробела.
> Спецификация модели — код пишется в подэтапах после согласования.

## Зачем эта фаза

В фазе 0 builder построен под **7 жёстко-зашитых комплектаций** (`config_type` enum: standard/universal/maximum/medium/light/mini/individual). Каждая описана в коде в `lib/album-builder/scenarios.ts`.

**Реальность:**
- У Сергея 7 «комплектаций» — это пресеты типичных настроек, не закрытый список
- У партнёров будут свои наборы параметров под их бренд
- Параметры должны быть произвольно комбинируемы (например «Универсал но с 2 разворотами на ученика и без цитаты»)
- В системе отбора фотографий уже работает гибкая модель — фотограф настраивает каждый параметр альбома индивидуально, «Универсал» это просто кнопка-пресет которая заполняет форму типичными значениями

**Архитектурный долг:** builder знает только 7 фиксированных комбинаций. Не работает с произвольными.

**Цель фазы 0.5:** сделать builder универсальным. Пресет — это **запись в БД** с произвольным набором параметров. Текущие 7 пресетов мигрируют в таблицу как «глобальные дефолты». Партнёры могут создавать свои.

## Принципы

### 1. Пресет описывает ЧТО (требования), а не КАК (имена мастеров)

**Плохо:**
```
preset: { student_master: 'E-Student-Standard', teacher_master: 'F-Head-WithPhoto' }
```

**Хорошо:**
```
preset: {
  student_section: { 
    students_per_unit: 2, unit_is_spread: true, has_quote: true,
    photos_friend_min: 0, photos_friend_max: 0,
  },
  teacher_section: { type: 'two_page', ... }
}
```

Builder сам ищет в template_set мастера которые удовлетворяют требованиям (через `slot_capacity`, `page_role`, `default_for_configs`).

Это позволяет добавлять новые мастера в template_set **без изменений в пресетах**. И позволяет одному пресету работать с разными template_set (если их станет несколько).

### 2. Пресет — это композиция секций

Альбом состоит из секций которые идут в строгом порядке:
- **intro** (для soft) — вступительная страница
- **teachers** — учительский раздел
- **students** — личный раздел учеников (главная часть)
- **common** — общий раздел (фото класса, коллажи, события)

Каждая секция в пресете либо **есть** (с настройками) либо **отсутствует** (`null`).

### 3. Каждая секция конфигурируется отдельно

Пресет — это не «семь enum значений», а **дерево конфигурации** с ~20 параметрами. Подробности секций описаны ниже.

### 4. Пресет принадлежит template_set'у косвенно

Пресет описывает **требования к мастерам**. Конкретный template_set (с конкретными мастерами) подбирается отдельно. То есть один пресет «Стандарт» может работать с разными template_set'ами «Плотные мастер белый» / «Плотные мастер чёрный» / «Минималистичный».

Это уже работает в фазе 0 на уровне applies_to_configs / default_for_configs — мы это сохраняем.

## Структура таблицы config_presets

```sql
CREATE TABLE config_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Принадлежность
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
    -- NULL = глобальный пресет (доступен всем тенантам)
    -- UUID = персональный пресет тенанта
  
  -- Идентификация
  slug text NOT NULL,                        -- 'standard', 'universal', custom-slug
  name text NOT NULL,                        -- 'Стандарт', 'Мой премиум'
  description text,                          -- свободное описание
  
  -- Версионирование (важно когда пресет меняется после привязки к альбомам)
  version int NOT NULL DEFAULT 1,
  parent_preset_id uuid REFERENCES config_presets(id),
    -- ссылка на пресет от которого "форкнули" — для аудита
  
  -- Главные параметры
  print_type text NOT NULL CHECK (print_type IN ('layflat', 'soft')),
  
  -- Конфигурация секций — JSONB
  config jsonb NOT NULL,
    -- Структура config описана ниже в "Структура поля config"
  
  -- Метаданные
  is_template boolean DEFAULT false,
    -- true = это шаблон для копирования (не используется напрямую)
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT unique_tenant_slug UNIQUE NULLS NOT DISTINCT (tenant_id, slug)
);

CREATE INDEX idx_config_presets_tenant ON config_presets(tenant_id);
CREATE INDEX idx_config_presets_slug ON config_presets(slug);
```

И связь с `albums`:

```sql
ALTER TABLE albums
DROP COLUMN config_type,  -- удаляем enum, заменяем на FK
ADD COLUMN config_preset_id uuid REFERENCES config_presets(id);
-- print_type оставляем как есть
```

## Структура поля `config` (JSONB)

Это самая важная часть. Опишу каждый блок.

```jsonc
{
  // === БАЗОВЫЕ ПАРАМЕТРЫ (наследуются всеми секциями) ===
  
  // === INTRO (только для soft) ===
  // Если null — секция отсутствует (для layflat всегда null)
  "intro_section": null | {
    "type": "single_page",      // только этот тип в фазе 0.5
    // Builder найдёт мастер с page_role='intro'
  },
  
  // === УЧИТЕЛЬСКИЙ РАЗДЕЛ ===
  // Если null — раздел отсутствует
  "teacher_section": null | {
    "enabled": true,
    "layout": "two_page" | "one_page",
      // two_page = F-* + G-* (стандартный layflat)
      // one_page = только F-*-R (Mini-soft case)
    
    "show_head_teacher": true,
      // включать ли карточку классного руководителя
    
    "max_subjects_per_page": 8,
      // сколько предметников помещается на левой странице (F-* мастер)
      // Builder ищет мастер с teachers >= subjects_count
    
    "right_page_content": "auto" | "fixed",
      // auto = builder выбирает G-* по common photos (current logic)
      // fixed = указан конкретный right_master_role
    
    "right_master_role": "common_photo" | null,
      // используется только если right_page_content='fixed'
  },
  
  // === ЛИЧНЫЙ РАЗДЕЛ УЧЕНИКОВ ===
  "student_section": {
    // КАК НА ОДНОГО УЧЕНИКА:
    "spreads_per_student": {
      "min": 1,  
      "max": 1,  // в фазе 0.5 max=1; multiple spreads — отдельная подфаза
      "default": 1,
    },
    
    // ТИП РАЗМЕЩЕНИЯ:
    "layout_mode": "single_page_per_student" 
                 | "spread_per_student"  
                 | "grid_multiple_students",
      // single_page_per_student = E-Student-Standard, E-Student-Left, etc.
      //   Один ученик на странице. Two students = одна страница каждому = разворот.
      //   Применимо для standard, universal.
      
      // spread_per_student = E-Max-Left + E-Max-Right
      //   Один ученик на разворот (личная страница + страница с фото друзей).
      //   Применимо для maximum, individual.
      
      // grid_multiple_students = D-Medium-Left, L-6, N-12
      //   Несколько учеников на странице (сетка).
      //   Применимо для medium, light, mini.
    
    // СОДЕРЖАНИЕ КАЖДОЙ КАРТОЧКИ УЧЕНИКА:
    "card_content": {
      "portrait": true,         // обязательно есть
      "full_name": true,        // обязательно есть
      
      "quote": {
        "enabled": true,
        "type": "from_catalog" | "free_text",
          // from_catalog = выбор из таблицы quotes
          // free_text = свободный текст ученика
        "max_chars": 200,
      },
      
      "free_text": {            // отдельно от quote (некоторые альбомы имеют оба)
        "enabled": false,
        "type": "free" | "kindergarten" | "grade_4" | "grade_9_11",
        "max_chars": 500,
      },
    },
    
    // ФОТО С ДРУЗЬЯМИ (groupphotos):
    "friend_photos": {
      "enabled": true,
      "min": 0,
      "max": 4,
        // builder ищет мастер с photos_friend >= max
      "exclusive": true,
        // если true — каждое фото может быть выбрано только одним учеником
    },
    
    // ОПЦИОНАЛЬНО: Сетка-миниатюр (для individual)
    "thumbnails_section": null | {
      "enabled": true,
      // в конце личного раздела добавляются страницы со всеми учениками в сетке
      // builder использует grid_multiple_students мастера (N-* или L-*)
      "preferred_grid_size": 12,   // примерное кол-во учеников на странице
    },
  },
  
  // === ОБЩИЙ РАЗДЕЛ (J-* мастера) ===
  // Если null — раздел не генерируется автоматически
  // (партнёр может добавить вручную через UI редактора в фазе 4)
  "common_section": null | {
    "enabled": false,
    // Builder автоматически НЕ генерирует common раздел — это решение фазы 0
    // (idml-recon §9). Эта структура зарезервирована на будущее.
    "auto_generate": false,
  },
  
  // === ОБЛОЖКА ===
  "cover_section": {
    "mode": "required" | "same_portrait" | "optional_paid" | "optional_free",
    "price": 300,  // если optional_paid
    // Builder использует мастер с page_role='cover' (если есть в template_set)
  },
  
  // === ПЕРСОНАЛЬНЫЙ РАЗВОРОТ ЗА ДОПЛАТУ ===
  // ОТДЕЛЬНАЯ ФИЧА — параметры альбома, не builder'а
  // Хранится здесь для полноты модели, но builder её не обрабатывает
  // (это отдельный модуль с personal_spread_photos)
  "personal_spread_addon": null | {
    "enabled": true,
    "price": 1000,
    "min_photos": 6,
    "max_photos": 12,
  },
}
```

## Как builder будет работать с пресетом

### Текущий buildAlbum (упрощённо):

```typescript
function buildAlbum(input: AlbumInput, config: Config): Result {
  const scenario = SCENARIOS[config.config_type]  // ← жёстко из кода
  
  if (config.print_type === 'soft' && scenario.intro_section) {
    buildIntroSection(...)
  }
  if (scenario.teacher_section) {
    buildTeacherSection(...)
  }
  if (scenario.individual_student_section) {
    buildIndividualStudents(...)
  } else {
    buildStudentsSection(scenario.student_section)
  }
  // ...
}
```

### Новый buildAlbum:

```typescript
function buildAlbum(input: AlbumInput, preset: Preset, template_set: TemplateSet): Result {
  // intro
  if (preset.print_type === 'soft' && preset.config.intro_section) {
    buildIntroSection(preset.config.intro_section, template_set)
  }
  
  // teachers
  if (preset.config.teacher_section?.enabled) {
    buildTeacherSection(preset.config.teacher_section, template_set, input.subjects, input.head_teacher)
  }
  
  // students — тут логика выбирается по layout_mode
  const layout = preset.config.student_section.layout_mode
  
  if (layout === 'single_page_per_student') {
    // двое учеников = разворот, найди мастер с students=1 или students=2
    buildSinglePagePerStudent(preset.config.student_section, ...)
  } else if (layout === 'spread_per_student') {
    // один ученик = разворот (E-Max-Left + E-Max-Right)
    buildSpreadPerStudent(preset.config.student_section, ...)
  } else if (layout === 'grid_multiple_students') {
    // адаптивная сетка (D-Medium / L-6 / N-12)
    buildAdaptiveGrid(preset.config.student_section, ...)
  }
  
  // thumbnails (для individual)
  if (preset.config.student_section.thumbnails_section?.enabled) {
    buildThumbnailsSection(preset.config.student_section.thumbnails_section, ...)
  }
  
  // common — НЕ генерируется автоматически в фазе 0.5
}
```

Главное отличие: **builder не знает имена мастеров**. Он знает **layout_mode** и **slot_capacity_min** требования. Поиск конкретных мастеров идёт через существующий `findMaster` (который уже работает с семантическими тегами).

## Миграция текущих 7 пресетов в БД

Это seed-файл — после создания таблицы `config_presets` мы вставляем 7 записей которые точно повторяют поведение текущего фазы 0.

| slug | layout_mode | quote | text | friend_photos | print_type | особенности |
|------|-------------|-------|------|---------------|------------|---|
| standard | single_page_per_student | да | нет | 0/0 | layflat+soft | spreads_per_student=1 |
| universal | single_page_per_student | да | нет | 0/0 | layflat+soft | то же что standard, но Left+Right разные мастера |
| maximum | spread_per_student | да | нет | 0/4 | layflat+soft | один ученик на разворот |
| medium | grid_multiple_students | да | нет | 0/0 | layflat+soft | 4 ученика на странице |
| light | grid_multiple_students | нет | нет | 0/0 | layflat+soft | 6 на странице |
| mini | grid_multiple_students | нет | нет | 0/0 | layflat+soft | 12 на странице, soft без intro |
| individual | spread_per_student + thumbnails | да | нет | 0/3 | layflat+soft | разворот + сетка миниатюр в конце |

Все 7 — глобальные (`tenant_id=NULL`).

## Семантика layout_mode → builder logic

| layout_mode | Что делает builder | Какие мастера искать |
|---|---|---|
| `single_page_per_student` | По 1 ученику на каждой странице, пары ученников образуют разворот | `page_role IN ('student', 'student_left', 'student_right')` с `students:1` или `students:2` |
| `spread_per_student` | Один ученик = две страницы (left=портрет, right=4 фото) | `page_role IN ('student_left', 'student_right')` с `students:1` |
| `grid_multiple_students` | N учеников на странице в сетке, basePages варьируется | `page_role IN ('student_grid_left', 'student_grid_right')` с максимально допустимой `students:N` |

Текущие функции в build.ts (`buildStandardStudents`, `buildMaximumStudents`, `buildMediumStudents`, `buildAdaptiveGridStudents`) — становятся **тремя обобщёнными функциями** по этим трём режимам. Логика overflow и spread_per_student уже есть, надо обобщить.

## Этапы реализации фазы 0.5

| Подэтап | Что | Объём |
|---|---|---|
| 0.5.0 | Эта спека (готова) | — |
| 0.5.1 | Миграция БД: таблица `config_presets`, FK в albums, удалить config_type | ~1 ч |
| 0.5.2 | TypeScript-типы Preset, миграция SCENARIOS из кода в seed-данные БД | ~2 ч |
| 0.5.3 | Рефакторинг buildAlbum: принимает Preset, выбирает обобщённую функцию по layout_mode | ~3 ч |
| 0.5.4 | 3 обобщённые функции построения (single_page / spread / grid) | ~3-4 ч |
| 0.5.5 | Адаптация 58 smoke-сцен под новую модель | ~2 ч |
| 0.5.6 | Endpoint build_album_test — обновить input под Preset, UI Build Test остаётся | ~1.5 ч |
| 0.5.7 | Контекст v40 + обновление phase-1-spec под новую модель | ~30 мин |
| **Итого** | | **~13-14 часов** |

После 0.5 фаза 1 (`loadAlbumInput`, `build_album_real`, UI «Вёрстка»):
- **Проще** потому что preset уже в БД, builder универсален
- **Имеет дополнительную работу** — UI выбора пресета (не enum) в карточке альбома
- Объём ~10-12 ч (как было)

## Что НЕ входит в фазу 0.5

- UI редактора пресетов (это фаза «партнёрский конструктор» — позже)
- Множественные разворты на ученика (`spreads_per_student.max > 1`) — заложено в модели, но реализация позже
- Кастомные секции (например — отдельный раздел «Учителя начальной школы») — позже
- Common section auto-generation — отложено в idml-recon §9
- Personal spread addon (родитель загружает свои фото) — отдельный модуль, не builder'а

## Открытые вопросы для обсуждения

Эти моменты требуют ответа Сергея перед стартом 0.5.1:

### 1. Что делать с уже созданным `albums.config_type` (миграция 1.0)?

Мы сегодня добавили колонку `config_type` text. В 0.5.1 надо её удалить и заменить на `config_preset_id` uuid FK.

**Backfill существующих альбомов:** все 9 текущих имеют NULL → они получат NULL в `config_preset_id` тоже. Никаких потерь.

**Подэтап 1.0 не делал backfill** — это было намеренно, так что ничего ломать не приходится.

### 2. Что с template_set — один или несколько?

Сейчас один глобальный template_set (`okeybook-default`). Пресет ссылается на template_set?

**Вариант X:** пресет НЕ ссылается на template_set. Альбом ссылается отдельно: `albums.template_set_id` + `albums.config_preset_id`. То есть фотограф выбирает «какие мастера» (template_set) и «какие правила» (preset) независимо.

**Вариант Y:** пресет содержит `template_set_id`. Фотограф выбирает только «какой пресет», template_set приходит автоматически.

Я склоняюсь к **X** — большая гибкость, проще модель. Согласен?

### 3. Множественные разворты на ученика — жёсткий лимит max=1 в фазе 0.5?

В пресете заложено поле `spreads_per_student.max`, но в 0.5 жёстко проверяем `max=1` (как сейчас). Реализация >1 — отдельный подэтап после 0.5.

**Альтернатива:** сразу делать поддержку >1, но это +5-7 ч к фазе 0.5. Я склоняюсь к жёсткому лимиту в 0.5 — итеративный подход.

### 4. Как обрабатывать неполный пресет в БД?

Если в БД пресет с пропущенным полем (например, `student_section` не задан) — builder падает или выдаёт warning?

**Я предлагаю** — fallback на дефолтный пресет (standard). Warning. Это даст устойчивость к ошибкам в данных и плавную деградацию.

### 5. Версии пресета

В таблице есть `version` поле. Зачем? Если пресет привязан к альбому (`albums.config_preset_id`) и пресет потом меняется в БД — альбом получит **новую** конфигурацию при следующей сборке. Это может ломать ожидания партнёра («я уже одобрил, не хочу чтобы менялось»).

**Решение:** при первой сборке alburm.config_preset_id показывает на актуальную версию. При сохранении layout в `album_layouts` — копируем snapshot пресета в layout. Дальнейшие изменения пресета не влияют.

**Альтернатива:** иммутабельные пресеты — изменение = новая запись с тем же slug но version+1. Проще архитектурно. Но усложняет UX (партнёр меняет пресет → должен явно мигрировать существующие альбомы).

Я склоняюсь к **первой схеме** (snapshot в album_layouts). Подсимплифицируем `version` поле в БД — оставим но не используем активно.

## Что я хочу от тебя

Прочитай этот документ. Скажи:
1. Согласен ли с принципами (1-4)?
2. Структура config — что упустил, что лишнее, где у тебя бывает иначе?
3. По 5 открытым вопросам — твоё мнение или «как ты скажешь»?
4. Видишь ли ты ситуации в своих 1000 альбомах в год которые **не покрываются** этой моделью?

После твоих правок — итерируем спеку, и потом запускаем 0.5.1.
