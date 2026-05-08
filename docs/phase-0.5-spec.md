# Фаза 0.5 — Refactor builder под гибкий конструктор пресетов (v2)

> Документ обновлён 07.05.2026 после уточнений Сергея.
> Спецификация модели — код пишется в подэтапах после согласования.

## Зачем эта фаза

В фазе 0 builder построен под **7 жёстко-зашитых комплектаций** (`config_type` enum). Каждая описана в коде в `lib/album-builder/scenarios.ts`.

**Реальность:**
- 7 «комплектаций» — это **внутренние пресеты Сергея**, не закрытый список
- Каждый параметр альбома (обложка, текст ученика, фото с друзьями, ...) задаётся **независимо** в форме создания альбома
- Партнёры в будущем должны иметь возможность создавать свои пресеты под свой бренд
- В системе отбора фотографий уже работает гибкая модель — «Универсал» это просто кнопка-пресет которая заполняет форму типичными значениями

**Цель фазы 0.5:** сделать builder универсальным. Пресет — это запись в БД с произвольным набором параметров.

## Принципы

### 1. Дизайн ≠ настройки

Сергей сформулировал точно:

> Дизайн — это набор мастеров на все случаи жизни и комплектации. А система должна правильно их распределять в зависимости от выбора настроек фотографа и количества загруженных фотографий.

То есть:
- **template_set** = «дизайн» = коллекция мастеров (разворотов и страниц)
- **preset** = «настройки» = правила сборки (что включено, какие лимиты, что персонализировано)
- **Они независимы.** Любой пресет работает с любым template_set'ом, если в template_set есть мастера нужной семантики.

### 2. Пресет описывает требования, не имена мастеров

Пресет говорит «здесь должна быть страница с портретом и текстом до 200 символов». Builder ищет в template_set мастер удовлетворяющий требованиям (через `page_role`, `slot_capacity`, теги). Это позволяет:
- Менять template_set без изменения пресета
- Добавлять новые мастера в template_set без изменения пресета
- Иметь несколько template_set'ов одновременно

### 3. Пресет — композиция секций

Альбом состоит из секций в строгом порядке:
- intro (для soft) — вступительная страница
- teachers — учительский раздел
- students — личный раздел учеников (главная часть)
- common — общий раздел (фото класса, коллажи)

Каждая секция в пресете либо есть либо отсутствует.

### 4. Параметры могут быть «общие для всех» или «персональные»

Это критически важно — увидено на скриншоте фотобота:

> «Обложка: Для всех уникально / Для всех одинаково»  
> «Индивидуальный разворот: Для всех уникально / Для всех одинаково»  
> «Классный руководитель: Для всех одинаково» (всегда общий)

Большинство параметров имеют флаг **per_student** (true = у каждого ученика своя версия, false = общая для всех учеников альбома).

### 5. Пресет не привязан к template_set'у

См. Принцип 1. В таблице `config_presets` нет `template_set_id`. Альбом ссылается на оба отдельно.

## Структура таблицы config_presets

```sql
CREATE TABLE config_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
    -- NULL = глобальный пресет (доступен всем тенантам)
  
  slug text NOT NULL,
  name text NOT NULL,                        -- 'Стандарт', 'Премиум 2 разворота'
  description text,
  
  print_type text NOT NULL CHECK (print_type IN ('layflat', 'soft')),
  
  config jsonb NOT NULL,
    -- Структура описана ниже в "Структура поля config"
  
  is_template boolean DEFAULT false,
    -- true = шаблон для копирования, не используется напрямую
  
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT unique_tenant_slug UNIQUE NULLS NOT DISTINCT (tenant_id, slug)
);

CREATE INDEX idx_config_presets_tenant ON config_presets(tenant_id);
```

И связь с `albums`:

```sql
ALTER TABLE albums
DROP COLUMN config_type,  -- удаляем enum (был добавлен в 1.0)
ADD COLUMN config_preset_id uuid REFERENCES config_presets(id),
ADD COLUMN template_set_id uuid REFERENCES template_sets(id);
-- print_type оставляем как было

-- Backfill: все 9 существующих альбомов имеют config_type=NULL
-- → config_preset_id остаётся NULL → UI запросит выбор перед сборкой.
```

## Каталог шаблонов текста (отдельная таблица)

```sql
CREATE TABLE text_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
    -- NULL = глобальный шаблон
  
  slug text NOT NULL,
    -- 'free', 'kindergarten_quiz', 'grade_4_quiz', 'grade_9_11_about_me'
  name text NOT NULL,
    -- 'Свободный текст', 'Анкета "Мой садик"', 'Анкета "Что я люблю"'
  
  type text NOT NULL CHECK (type IN ('free', 'questionnaire', 'quote_catalog')),
    -- free = чистое поле для свободного ввода
    -- questionnaire = список вопросов на которые ученик отвечает
    -- quote_catalog = выбор из готовых цитат (отдельная таблица quotes)
  
  -- Если type = 'questionnaire':
  questions jsonb,
    -- [{question: "Любимый цвет", placeholder: "Зелёный", max_chars: 30}, ...]
  
  -- Если type = 'free' или 'questionnaire':
  default_max_chars int,
  
  -- Если type = 'quote_catalog':
  quotes_filter text,
    -- 'all' / 'school' / 'kindergarten' / null = все доступные
  
  CONSTRAINT unique_tenant_slug_text UNIQUE NULLS NOT DISTINCT (tenant_id, slug)
);
```

В пресете будет ссылка `text_template_id` (или массив, если несколько режимов).

## Структура поля `config` (JSONB)

Ниже — полная структура. Помечены `[per_student?: bool]` поля где параметр может быть либо общим либо персональным.

```jsonc
{
  // === ЛИЧНЫЙ РАЗДЕЛ УЧЕНИКОВ ===
  "student_section": {
    
    // ── Кол-во разворотов на ученика ──
    "spreads_per_student": {
      "min": 1,
      "max": 1,
      "default": 1,
      "per_student": false,
        // false = у всех одинаковое количество
        // true = у каждого ученика своё (за доплату)
    },
    
    // ── Базовый layout первого разворота ──
    "base_layout_mode": "single_page_per_student"
                     | "spread_per_student"
                     | "grid_multiple_students",
      // single_page_per_student = E-Student-Standard, E-Student-Left, etc.
      //   Один ученик на странице. Пара = разворот.
      //   Применимо для standard, universal.
      //
      // spread_per_student = E-Max-Left + E-Max-Right
      //   Один ученик = разворот (личная стр + страница с фото друзей).
      //   Применимо для maximum, individual.
      //
      // grid_multiple_students = D-Medium-Left, L-6, N-12
      //   Несколько учеников на странице (сетка).
      //   Применимо для medium, light, mini.
    
    // ── Содержание первого разворота ──
    "first_spread_content": {
      "portrait": true,      // обязательно
      "full_name": true,     // обязательно
      
      // Текст ученика
      "text": null | {
        "enabled": true,
        "text_template_id": "uuid-of-text-template",
          // ссылка на text_templates
        "max_chars_override": 200,
          // override default_max_chars из шаблона
        "modes_allowed": ["free", "quote_catalog"],
          // если шаблон позволяет несколько режимов
          // например для 9-11 класса: ['free', 'quote_catalog']
      },
      
      // Фото с друзьями (groupphotos)
      "friend_photos": null | {
        "enabled": true,
        "min": 0,
        "max": 4,
          // на ВЕСЬ личный раздел ученика (включая доп. развороты)
        "exclusive_in_album": true,
          // одно фото может попасть в личный раздел только одного ученика
          // (Сергей: «чтобы фото с друзьями не повторялись на каждой странице»)
      },
    },
    
    // ── Дополнительные развороты (за доплату) ──
    "additional_spreads": null | {
      "enabled": true,
      "max_count": 4,
        // максимум сколько может купить родитель
      "price_per_spread": 1500,
      
      // Контент дополнительных разворотов
      // (НЕ включает портрет/имя/текст — только фото)
      "content_options": [
        {
          "name": "Только фото с друзьями",
          "uses_friend_photos": true,
            // тянет из того же пула что first_spread.friend_photos
          "min_photos": 4,
          "max_photos": 12,
        },
        {
          "name": "Фото и текст",
          "uses_friend_photos": true,
          "additional_text": true,
          "min_photos": 4,
          "max_photos": 8,
        },
      ],
    },
    
    // ── Сетка-миниатюр (для individual комплектации) ──
    "thumbnails_section": null | {
      "enabled": true,
      "preferred_grid_size": 12,
        // примерное кол-во учеников на странице
        // builder ищет grid_multiple_students мастера
    },
  },
  
  // === УЧИТЕЛЬСКИЙ РАЗДЕЛ ===
  "teacher_section": null | {
    "enabled": true,
    "layout": "two_page" | "one_page",
      // two_page = F-* + G-* (стандартный layflat)
      // one_page = только F-*-R (Mini-soft)
    
    "show_head_teacher": true,
    "max_subjects_per_page": 8,
    
    "right_page_content": "auto_common_photo" | null,
      // auto_common_photo = G-* выбирается по common photos
      // null = только F-* (одностраничный режим)
  },
  
  // === ОБЛОЖКА ===
  // ВАЖНО: два независимых параметра — финансовый режим и тип
  "cover_section": {
    
    // Финансовый режим
    "financial_mode": "required" 
                   | "optional_paid_visible"
                   | "optional_paid_hidden",
      // required = обязательно для всех (заранее оплачено через менеджера)
      // optional_paid_visible = на выбор, родитель видит цену
      // optional_paid_hidden = на выбор, родитель не видит цену
      //   (менеджер потом сам обсудит в чате)
    
    "price": 300,
      // используется во всех режимах для расчёта (даже hidden — для менеджера)
    
    // Тип обложки
    "cover_type": "portrait_photo" 
               | "common_photo"
               | "design_only",
      // portrait_photo = портрет ученика на обложке
      // common_photo = общая фотография класса
      // design_only = дизайн без фото
      // (могут добавиться варианты в будущем)
    
    "per_student": true,
      // true = у каждого ученика своя обложка
      // false = одна общая на весь класс/альбом
  },
  
  // === ПЕРСОНАЛЬНЫЙ РАЗВОРОТ ЗА ДОПЛАТУ ===
  // Отдельная фича — родитель загружает свои фото
  // Builder её НЕ обрабатывает в фазе 0.5 (отдельный модуль)
  // Хранится для полноты модели
  "personal_spread_addon": null | {
    "enabled": true,
    "price": 1000,
    "min_photos": 6,
    "max_photos": 12,
    "per_student": true,
  },
  
  // === ОБЩИЙ РАЗДЕЛ (J-* мастера, виньетки, коллажи) ===
  // Сергей: «Виньетка», «Коллажи» (несколько штук)
  "common_section": null | {
    "enabled": true,
    "auto_generate": false,
      // В фазе 0.5 builder НЕ генерирует автоматически (idml-recon §9)
      // Партнёр добавит вручную через UI редактора (фаза 4)
    
    // Что разрешено добавить в общий раздел вручную:
    "vignette": {
      "enabled": true,
      "per_student": false,
        // одна виньетка на класс
    },
    "collages": {
      "enabled": true,
      "max_count": 4,
        // сколько коллажей можно добавить
    },
    "class_photo": {
      "enabled": true,
        // основное фото класса
    },
    "half_class_photos": {
      "enabled": true,
      "max_count": 2,
    },
  },
  
  // === INTRO (для soft) ===
  "intro_section": null | {
    "type": "single_page",
    "with_photo": true,
      // включать ли фото на intro странице
  },
}
```

## Семантика layout_mode → builder logic

| layout_mode | Что делает builder | Какие мастера искать |
|---|---|---|
| `single_page_per_student` | По 1 ученику на странице, пары образуют разворот | `page_role IN ('student', 'student_left', 'student_right')` с `students:1` или `students:2` |
| `spread_per_student` | Один ученик = разворот (left=портрет, right=фото) | `page_role IN ('student_left', 'student_right')` с `students:1` |
| `grid_multiple_students` | N учеников на странице в сетке | `page_role IN ('student_grid_left', 'student_grid_right')` с `students:N` |

Текущие функции (`buildStandardStudents`, `buildMaximumStudents`, `buildMediumStudents`, `buildAdaptiveGridStudents`) обобщаются в **3 функции** по этим режимам. Логика overflow и spread per student уже есть — обобщаем.

## Поддержка нескольких разворотов на ученика

Если `spreads_per_student.max > 1`:
- Builder для каждого ученика создаёт **базовый разворот** (по `base_layout_mode`)
- Затем для каждого **дополнительного** разворота (если `additional_spreads.enabled`) генерирует страницы:
  - Количество доп. разворотов берётся из `albums.album_data.spreads_count_per_student[child_id]` или такой структуры
  - Контент берётся из `additional_spreads.content_options[].uses_friend_photos` etc.
- Builder **не выбирает** конкретные мастера для доп. разворотов в фазе 0.5 — нужны новые мастера в template_set (M-Photos-12 etc., откладываем дизайнеру в master-cleanup-tz)

В фазе 0.5 поддержка `spreads_per_student.max > 1` есть на уровне **модели данных и builder API**, но **фактически работает с max=1** (предупреждение если max>1 и нет нужных мастеров — warning, не error).

## Миграция текущих 7 пресетов в БД

Seed-файл — после создания таблицы `config_presets` вставляем 7 записей.

Краткая таблица соответствия (полные JSON будут в seed SQL):

| slug | base_layout_mode | text | friend_photos | print_type | особенности |
|------|------------------|------|---------------|------------|-------------|
| standard | single_page_per_student | text:free | 0/0 | layflat+soft | spreads=1 |
| universal | single_page_per_student | text:free | 0/0 | layflat+soft | как standard, но Left+Right разные |
| maximum | spread_per_student | text:free | 0/4 | layflat+soft | один = разворот |
| medium | grid_multiple_students | text:free | 0/0 | layflat+soft | 4/страница |
| light | grid_multiple_students | null | 0/0 | layflat+soft | 6/страница |
| mini | grid_multiple_students | null | 0/0 | layflat+soft | 12/страница, soft без intro |
| individual | spread_per_student + thumbnails | text:free | 0/3 | layflat+soft | разворот + сетка миниатюр |

Все 7 — глобальные (`tenant_id=NULL`), `is_template=false` (используются напрямую).

## Этапы реализации фазы 0.5

| Подэтап | Что | Объём |
|---|---|---|
| 0.5.0 | Эта спека (готова) | — |
| 0.5.1 | Миграция БД: `config_presets`, `text_templates`, FK в albums, удалить config_type | ~1.5 ч |
| 0.5.2 | TypeScript-типы Preset + TextTemplate, миграция SCENARIOS из кода в seed-данные | ~3 ч |
| 0.5.3 | Рефакторинг buildAlbum: принимает Preset, выбирает обобщённую функцию по base_layout_mode | ~3 ч |
| 0.5.4 | 3 обобщённые функции построения (single_page / spread / grid) | ~3-4 ч |
| 0.5.5 | Поддержка multiple spreads (с warning если нет мастеров — не error) | ~2 ч |
| 0.5.6 | Адаптация 58 smoke-сцен под новую модель | ~2 ч |
| 0.5.7 | Endpoint build_album_test — обновить input под Preset, UI Build Test | ~1.5 ч |
| 0.5.8 | Контекст v40 + обновление phase-1-spec | ~30 мин |
| **Итого** | | **~16-17 часов** |

После 0.5 фаза 1:
- `loadAlbumInput` — конвертер реальных данных
- `build_album_real` endpoint
- UI выбор пресета в карточке альбома (вместо enum)
- Bulk-тестирование

Объём фазы 1 после 0.5: ~10-12 ч (как было).

## Что НЕ входит в фазу 0.5

- UI редактора пресетов (фаза «партнёрский конструктор» — позже)
- UI редактора каталога text_templates (позже)
- Новые мастера для дополнительных разворотов (M-Photos-12 etc.) — дизайнеру в master-cleanup-tz
- Common section auto-generation (idml-recon §9 — отложено)
- Personal spread addon обработка builder'ом — отдельный модуль

## Открытые вопросы (на завтра — обсудить с Сергеем)

### 1. text_templates в БД — глобальные или per-tenant?

**Глобальные:** Сергей создаёт каталог («Свободный», «Анкета 4 класс», «Анкета сад», «9-11 класс цитаты+свободный»). Все партнёры видят их. Не могут менять.

**Per-tenant:** партнёр может добавить свой шаблон («Анкета 11А класс школа 42»).

Я склоняюсь к **гибрид:** есть глобальные шаблоны (которые делает Сергей), партнёры могут создавать свои. Это уже заложено в схеме (`tenant_id NULL = глобальный`).

### 2. Версионирование пресетов

Если партнёр меняет пресет после привязки к альбому — что происходит со старыми альбомами?

**Решение по умолчанию:** при сохранении layout в `album_layouts` копируем snapshot пресета. Изменения пресета не влияют на уже собранные альбомы.

Это упрощает мысленную модель и снимает страх «случайно сломать продакшн».

### 3. Backfill 9 существующих альбомов

Все имеют `config_type=NULL`. После 0.5.1 они получат `config_preset_id=NULL` и `template_set_id=NULL`. Нужно:
- При попытке собрать — UI запрашивает выбор
- В UI карточки альбома (вкладка «Обзор») показ «Конфигурация не задана»

Никакого автоматического backfill не делаем. Это правильно.

### 4. Как партнёр выбирает пресет в /app

Подэтап 1.3 «UI вкладка Вёрстка» делает форму выбора. Нужно понять:
- Показываем все доступные пресеты (глобальные + свои тенантовские)?
- Или партнёр имеет «избранные» пресеты которые показываются по умолчанию?

Я склоняюсь к **простому варианту:** показываем все доступные. Группа «Глобальные» + «Мои». Сортировка по алфавиту.

## Что я хочу от Сергея завтра утром

1. **Прочитать спеку** свежим взглядом
2. **Скриншоты фотобота** (по списку из предыдущего сообщения):
   - Создание альбома — какие параметры спрашивают
   - «Несколько учеников на развороте» — варианты
   - «Коллажи» — несколько штук, что значат
   - Как создаётся кастомная комплектация
   - Что значит «Индивидуальный разворот: Для всех уникально»
3. **Ответы на 4 открытых вопроса** выше
4. **Проверка модели:** видишь ли ситуации в твоих 1000 альбомах которые не покрываются?

После итерации спеки — стартуем 0.5.1.
