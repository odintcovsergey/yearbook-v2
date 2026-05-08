# Фаза 0.5 — Refactor builder под пресеты (финальная v4)

> Документ создан 08.05.2026.  
> Архитектурный принцип: **богатая структура в БД, простая логика в коде**.

## Зачем

В фазе 0 builder работает с 7 жёстко-зашитыми комплектациями (`config_type` enum в коде). Это не гибко — партнёр не может создать свой пресет без правки кода.

**Цель:** перенести описание пресета из кода в БД. 7 текущих пресетов становятся записями в таблице `config_presets`. Builder читает пресет из БД и работает с ним универсально.

## Главное решение

**Богатая БД, простая логика.**

В таблице `config_presets` поле `config` (JSONB) может хранить десятки параметров — всё что обсуждалось (доплатные развороты, мульти-учителя, обложки разных типов, виньетки и т.д.). **Это резерв на будущее.**

В фазе 0.5 builder читает только **минимум** полей которые соответствуют функционалу фазы 0. Всё остальное в БД сохраняется но игнорируется.

Это значит:
- В будущем расширение функционала **не требует миграций БД** — поле уже есть в JSONB
- Текущий код фазы 0.5 не усложняется лишними фичами

## Решённые архитектурные моменты

| Момент | Решение |
|---|---|
| Один альбом — один пресет? | Нет. У каждого ребёнка свой `config_preset_id` (FK). По умолчанию NULL → берётся альбомный. |
| Стандарт vs Универсал — что отличает? | Параметр `friend_photos.max`: 0 для Стандарта, 2 для Универсала |
| Виртуальные страницы (1 spread мастер вместо Left+Right отдельных)? | Отложено в master-cleanup-tz §F |
| Несколько разворотов на ученика | Поле в БД зарезервировано, builder читает только max=1 в 0.5 |
| Текст ученика — свободный или цитата? | Поле `text.enabled` (boolean). Расширение (анкеты, режимы) — позже. |
| Мульти-учителя (2 воспитателя в саду)? | Поле в БД зарезервировано, builder использует только head_teacher (1) |
| Шаблон по умолчанию для текста | Зарезервировано, не реализовано в 0.5 |
| Общий раздел (J-* мастера) | Не генерируется builder'ом (idml-recon §9). UI редактор фазы 4. |
| Обложка — financial_mode и cover_type | Поля зарезервированы в БД, builder не использует в 0.5 |
| Personal spread addon | Отдельный модуль продукта (не builder) |
| Партнёрский конструктор пресетов | Отдельная фаза, не 0.5. В 0.5 — 7 готовых глобальных. |

## Этапы реализации

| Подэтап | Что | Объём |
|---|---|---|
| 0.5.1 | Таблица `config_presets`, FK в albums и children, удалить config_type | ~1.5 ч |
| 0.5.2 | TypeScript-типы Preset, 7 пресетов как seed-данные | ~3 ч |
| 0.5.3 | Рефакторинг buildAlbum — принимает Preset, выбирает функцию по layout_mode | ~3 ч |
| 0.5.4 | Адаптация 58 smoke-сцен под новую модель | ~2 ч |
| 0.5.5 | Endpoint `build_album_test` обновлён под Preset | ~1 ч |
| 0.5.6 | UI выбор пресета per-child в /app (опционально, простой dropdown) | ~1.5 ч |
| 0.5.7 | Контекст v40 + обновление phase-1-spec | ~30 мин |
| **Итого** | | **~12 часов** |

После 0.5 — фаза 1 (Smart-fill из реальных альбомов БД, ~10-12 часов).

---

## Структура БД (что строим в 0.5.1)

### Новая таблица `config_presets`

```sql
CREATE TABLE config_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
    -- NULL = глобальный пресет (доступен всем тенантам)
  
  slug text NOT NULL,                        -- 'standard', 'universal', 'maximum'...
  name text NOT NULL,                        -- 'Стандарт', 'Универсал'...
  description text,
  
  print_type text NOT NULL CHECK (print_type IN ('layflat', 'soft')),
  
  config jsonb NOT NULL,
    -- Богатая структура (см. ниже)
  
  is_template boolean DEFAULT false,
    -- зарезервировано на будущее
  
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT unique_tenant_slug UNIQUE NULLS NOT DISTINCT (tenant_id, slug)
);

CREATE INDEX idx_config_presets_tenant ON config_presets(tenant_id);
```

### Изменения в `albums`

```sql
ALTER TABLE albums
DROP COLUMN config_type,                    -- удаляем enum (был в 1.0)
ADD COLUMN config_preset_id uuid REFERENCES config_presets(id),
ADD COLUMN template_set_id uuid REFERENCES template_sets(id);
-- print_type оставляем (был в 1.0)
```

### Изменения в `children`

```sql
ALTER TABLE children
ADD COLUMN config_preset_id uuid REFERENCES config_presets(id);
-- NULL по умолчанию = используется albums.config_preset_id (альбомный)
-- если задан = override (например ученик купил Максимум вместо Стандарта)
```

### Backfill

- Все 9 существующих альбомов: `config_preset_id = NULL`, `template_set_id = NULL`. UI запросит выбор перед сборкой.
- Все 157 учеников: `config_preset_id = NULL`. Используется альбомный.

---

## Полная структура `config` (JSONB)

Помечено **🟢 = читает builder в 0.5** или **⚪ = зарезервировано в БД, builder игнорирует**.

```jsonc
{
  // === ЛИЧНЫЙ РАЗДЕЛ УЧЕНИКОВ ===
  "student_section": {
    
    // Кол-во разворотов на ученика
    "spreads_per_student": {
      "min": 1, "max": 1, "default": 1,    // 🟢 builder использует max=1
      "per_student": false,                  // ⚪ зарезервировано
    },
    
    // Базовый layout
    "base_layout_mode":                      // 🟢
        "single_page_per_student"            // E-Student-Standard, E-Student-Default, etc.
      | "spread_per_student"                 // E-Max-Left + E-Max-Right
      | "grid_multiple_students",             // D-Medium / L-6 / N-12
    
    // Содержание первого разворота
    "first_spread_content": {
      "portrait": true,                      // 🟢 (всегда true в 0.5)
      "full_name": true,                     // 🟢 (всегда true в 0.5)
      
      "text": null | {
        "enabled": true,                     // 🟢 (boolean)
        "max_chars": 200,                    // ⚪
        "modes_allowed": [...],              // ⚪ (свободный/цитата) — анкеты позже
        "text_template_id": null,            // ⚪ (анкеты позже)
      },
      
      "friend_photos": null | {
        "enabled": true,                     // 🟢
        "min": 0, "max": 4,                  // 🟢 max используется как slot_capacity_min
        "exclusive_in_album": true,          // ⚪ (логика отбора, не builder)
      },
    },
    
    // Доплатные развороты — ⚪ полностью зарезервировано
    "additional_spreads": null | {
      "enabled": true,
      "max_count": 4,
      "price_per_spread": 1500,
      "content_options": [...],
    },
    
    // Сетка-миниатюры (для individual)
    "thumbnails_section": null | {
      "enabled": true,                       // 🟢
      "preferred_grid_size": 12,             // 🟢
    },
  },
  
  // === УЧИТЕЛЬСКИЙ РАЗДЕЛ ===
  "teacher_section": null | {
    "enabled": true,                         // 🟢
    "layout": "two_page" | "one_page",       // 🟢 (Mini-soft = one_page)
    "show_head_teacher": true,               // 🟢
    "max_subjects_per_page": 8,              // 🟢
    "right_page_content":                    // 🟢
        "auto_common_photo" | null,
    
    "head_teachers_count": 1,                // ⚪ (мульти-учителя позже, builder использует 1)
    "default_text_when_empty": null,         // ⚪ (заглушка для пустого text)
  },
  
  // === ОБЛОЖКА ===
  "cover_section": {
    "cover_type":                            // 🟢 (на будущее, в 0.5 builder не верстает обложку)
        "portrait_photo" | "common_photo" | "design_only",
    
    "financial_mode":                        // ⚪
        "required" | "optional_paid_visible" | "optional_paid_hidden",
    "price": 300,                            // ⚪
    "per_student": true,                     // ⚪
  },
  
  // === INTRO (для soft) ===
  "intro_section": null | {
    "type": "single_page",                   // 🟢
    "with_photo": true,                      // ⚪
  },
  
  // === ОБЩИЙ РАЗДЕЛ (виньетки, коллажи, фото класса) — ⚪ полностью ===
  "common_section": null | {
    "enabled": true,
    "auto_generate": false,
    "vignette": {...},
    "collages": {...},
    "class_photo": {...},
    "half_class_photos": {...},
    "quarter_class_photos": {...},
  },
  
  // === ПЕРСОНАЛЬНЫЙ РАЗВОРОТ ЗА ДОПЛАТУ — ⚪ полностью ===
  "personal_spread_addon": null | {...},
}
```

---

## 7 пресетов — содержание config

Все 7 — глобальные (`tenant_id = NULL`).

### standard
- `print_type`: layflat и soft (две записи: standard-layflat, standard-soft)
- `student_section.base_layout_mode`: `single_page_per_student`
- `student_section.first_spread_content.text`: `{enabled: true}`
- `student_section.first_spread_content.friend_photos`: `null` (без фото с друзьями)
- `teacher_section`: `{enabled: true, layout: 'two_page', ...}`
- `intro_section`: для soft `{type: 'single_page'}`, для layflat `null`

### universal
- Всё то же что standard, но:
- `student_section.first_spread_content.friend_photos`: `{enabled: true, min: 0, max: 2}`

### maximum
- `student_section.base_layout_mode`: `spread_per_student`
- `student_section.first_spread_content.friend_photos`: `{enabled: true, min: 0, max: 4}`
- остальное как standard

### medium
- `student_section.base_layout_mode`: `grid_multiple_students`
- остальное как standard
- (Builder выберет мастера D-Medium с slot_capacity.students=4)

### light
- `student_section.base_layout_mode`: `grid_multiple_students`
- `student_section.first_spread_content.text`: `null` (без текста)
- `student_section.first_spread_content.friend_photos`: `null`
- (Builder выберет мастера L-6 с slot_capacity.students=6)

### mini
- `student_section.base_layout_mode`: `grid_multiple_students`
- `student_section.first_spread_content.text`: `null`
- `student_section.first_spread_content.friend_photos`: `null`
- В soft варианте: `intro_section: null`, `teacher_section.layout: 'one_page'`
- (Builder выберет мастера N-12 с slot_capacity.students=12)

### individual
- `student_section.base_layout_mode`: `spread_per_student`
- `student_section.first_spread_content.friend_photos`: `{enabled: true, min: 0, max: 3}`
- `student_section.thumbnails_section`: `{enabled: true, preferred_grid_size: 12}`

---

## Что меняется в коде (0.5.2-0.5.5)

### Типы

```typescript
// lib/album-builder/types.ts (расширение)

export type Preset = {
  id: string;
  slug: string;
  name: string;
  print_type: 'layflat' | 'soft';
  config: PresetConfig;
};

export type PresetConfig = {
  student_section: StudentSectionConfig;
  teacher_section: TeacherSectionConfig | null;
  intro_section: IntroSectionConfig | null;
  cover_section: CoverSectionConfig;
  // common_section, personal_spread_addon — зарезервировано, не типизируем
};

// ...подтипы StudentSectionConfig и т.д.
```

### Функция buildAlbum

```typescript
// БЫЛО:
function buildAlbum(input, config: { config_type, print_type, template_set })

// СТАЛО:
function buildAlbum(input, preset: Preset, template_set: TemplateSet)
```

Внутри: чтение `preset.config.student_section.base_layout_mode` и роутинг в одну из 3 функций (buildSinglePagePerStudent / buildSpreadPerStudent / buildGridStudents).

Существующие функции (`buildStandardStudents`, `buildMaximumStudents`, `buildAdaptiveGridStudents`, `buildMediumStudents`) обобщаются:
- `buildSinglePagePerStudent` ← объединение standard + universal (различия по friend_photos)
- `buildSpreadPerStudent` ← объединение maximum + individual (различия по friend_photos и thumbnails)
- `buildGridStudents` ← объединение medium + light + mini (различия по slot_capacity.students)

### Smoke-сцены

58 текущих сцен переписываются: вместо `configType: 'standard'` → `presetSlug: 'standard'` (загружается из БД через тот же loadTemplateSet helper).

### Endpoint /api/layout?action=build_album_test

Принимает `preset_slug` (или `preset_id`) вместо `config_type`. UI обновляется — выбор из dropdown пресетов.

---

## Что НЕ делаем в 0.5

- UI редактора кастомных пресетов
- UI редактора каталога текстов
- Builder обработка `additional_spreads` (надо мастеров от дизайнера)
- Builder обработка `personal_spread_addon` (отдельный модуль)
- Builder обработка `common_section` (idml-recon §9)
- Builder обработка `cover_section` (отдельная фаза)
- Виртуальные страницы (master-cleanup-tz §F)
- Мульти-учителя
- Шаблоны текста по умолчанию
- Версионирование пресетов

Всё это **может быть добавлено позже без миграций БД** — поля уже зарезервированы в JSONB.

---

## Готовность к 0.5.1

После согласования этой спеки — стартуем подэтап 0.5.1.

**Что сделает 0.5.1:**
1. Миграция БД: создание `config_presets`, удаление `albums.config_type`, добавление `config_preset_id` и `template_set_id` в `albums`, добавление `config_preset_id` в `children`
2. Файл миграции в репо
3. **Никакого кода** — только структура БД

**После 0.5.1:** билд продолжает работать как раньше (используя жёстко-зашитые SCENARIOS), потому что код пока не трогаем. Это нормально — постепенный рефакторинг.

В 0.5.2-0.5.5 поэтапно перевозим код на работу с БД-пресетами. До 0.5.5 включительно сохраняется backward compatibility — старый Build Test работает с `config_type`-параметром, который маппится на пресет.

---

# Готов?

Если да — стартуем 0.5.1 (миграция БД).
