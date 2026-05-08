# Фаза 0.5 — Refactor builder под пресеты (v3)

> Документ обновлён 08.05.2026 после обсуждения философии «проще, быстрее, понятнее».
> 
> **Главный архитектурный принцип:** богатая схема данных в БД + простая логика и UI в фазе 0.5. Это позволит расширяться в будущем без миграций.

## Зачем эта фаза

В фазе 0 builder построен под **7 жёстко-зашитых комплектаций** (`config_type` enum). Это работает но не масштабируется.

**Цель фазы 0.5:** перенести описание комплектаций из кода в БД. Текущие 7 пресетов мигрируют в таблицу как «глобальные дефолты». Builder становится универсальным.

## Философия Сергея

> «Я как фотограф отснял материал, отобрал с клиентами, выбрал макет и комплектацию, нажал кнопку, получил через 15 минут макет. И мне нравится такой подход.»

То есть **главный сценарий — простой и быстрый**:
1. Партнёр выбирает один из готовых пресетов (4-5 кнопок)
2. Нажимает «Собрать»
3. Через минуту получает результат

**Кастомизация пресета — редкая, продвинутая функция.** Не для массового пользователя.

**Доработка результата (drag-n-drop редактор) — есть, но редко используется.** Партнёр поправит мастера в 1-2 разворотах если builder не угадал.

## Архитектурный приём — «богатая БД, простая логика»

В этой спеке два уровня детализации:

### Уровень 1 — полная схема (богатая)

Раздел **«Полная схема config (зарезервировано в БД)»** ниже. Все поля сохраняются в `config_presets.config` (JSONB). 

Это **гибкая структура** под все возможные сценарии будущего: per_student флаги, additional_spreads, modes_allowed для текста, financial_mode для обложки, и т.д.

Записи в БД могут содержать любые из этих полей. Никаких миграций при расширении.

### Уровень 2 — что использует builder в фазе 0.5 (минимум)

Раздел **«Что читает builder в 0.5»** ниже. Маленький подсписок полей — только то что **реально нужно** сейчас для типичных кейсов.

Builder **игнорирует** все остальные поля. Они «зарезервированы» — будут читаться позже когда понадобится.

### Уровень 3 — что показывает UI в 0.5

UI = простая форма выбора пресета (как в существующей форме создания альбома: 4 кнопки + название). Никакого «конструктора».

---

# ЧАСТЬ 1: Принципы

### Принцип 1 — Дизайн ≠ Настройки

Сергей сформулировал точно:

> Дизайн — это набор мастеров на все случаи жизни и комплектации. А система должна правильно их распределять в зависимости от выбора настроек фотографа и количества загруженных фотографий.

- **template_set** = коллекция мастеров (39 разворотов)
- **preset** = правила сборки (что включено, какие лимиты)
- **Они независимы.** Любой пресет работает с любым template_set'ом.

### Принцип 2 — Пресет описывает требования, не имена мастеров

Пресет говорит «тут нужен мастер для одного ученика с местом под цитату». Builder ищет в template_set мастер с подходящим `page_role` и `slot_capacity`.

Это позволяет менять template_set без правок пресета. И добавлять новые мастера без правок пресета.

### Принцип 3 — Богатая БД, простая логика

Поля в `config_presets.config` могут описывать **любой** будущий сценарий. Builder в фазе 0.5 читает только подмножество. Расширение builder'а в будущем не требует миграций.

### Принцип 4 — Готовые пресеты = главный сценарий

7 готовых пресетов покрывают 95% случаев. Партнёр обычно выбирает из списка. Создание своего пресета — продвинутая функция, не делается в фазе 0.5.

---

# ЧАСТЬ 2: Полная схема `config` (богатая, в JSONB)

Всё что описано ниже — **зарезервировано** в БД. Builder в фазе 0.5 читает только пометку **«читает в 0.5»**. Остальное — на будущее.

```jsonc
{
  // ==================================================
  // ЛИЧНЫЙ РАЗДЕЛ УЧЕНИКОВ
  // ==================================================
  "student_section": {
    
    // ────────────────────────────────────────────────
    // Кол-во разворотов на ученика
    // ────────────────────────────────────────────────
    "spreads_per_student": {
      "min": 1,                  // ← читает в 0.5 (только если max==1)
      "max": 1,                  // ← читает в 0.5 (только =1; если >1 → warning)
      "default": 1,
      "per_student": false,      // зарезервировано (фаза N)
        // false = у всех одинаково
        // true = у каждого ученика своё (за доплату)
    },
    
    // ────────────────────────────────────────────────
    // Базовый layout первого разворота
    // ────────────────────────────────────────────────
    "base_layout_mode": "single_page_per_student"   // ← читает в 0.5
                     | "spread_per_student"
                     | "grid_multiple_students",
      // single_page_per_student = E-Student-* (1 ученик / страница)
      // spread_per_student = E-Max-Left + E-Max-Right (1 ученик / разворот)
      // grid_multiple_students = D-Medium / L-6 / N-12 (сетка)
    
    // ────────────────────────────────────────────────
    // Содержание первого разворота
    // ────────────────────────────────────────────────
    "first_spread_content": {
      "portrait": true,          // ← читает в 0.5 (всегда true в 0.5)
      "full_name": true,         // ← читает в 0.5 (всегда true в 0.5)
      
      // Текст ученика
      "text": null | {
        "enabled": true,         // ← читает в 0.5 (boolean)
        "text_template_id": "uuid", // зарезервировано (фаза N — выбор анкеты)
        "max_chars": 200,        // зарезервировано (UI ограничение)
        "modes_allowed": ["free", "quote_catalog"], // зарезервировано
          // фаза N — для 9-11 классов «или свободный или цитата»
      },
      
      // Фото с друзьями (groupphotos из selections.group)
      "friend_photos": null | {
        "enabled": true,         // ← читает в 0.5 (boolean)
        "min": 0,
        "max": 4,                // ← читает в 0.5 (для slot_capacity_min фильтра)
        "exclusive_in_album": true,  // зарезервировано (логика отбора, не builder)
          // одно фото попадает в личный раздел только одного ученика
      },
    },
    
    // ────────────────────────────────────────────────
    // Дополнительные развороты (за доплату)
    // ЗАРЕЗЕРВИРОВАНО — в 0.5 builder это игнорирует
    // ────────────────────────────────────────────────
    "additional_spreads": null | {
      "enabled": true,
      "max_count": 4,
      "price_per_spread": 1500,
      "content_options": [
        {
          "name": "Только фото",
          "uses_friend_photos": true,
          "min_photos": 4,
          "max_photos": 12,
        },
      ],
    },
    
    // ────────────────────────────────────────────────
    // Сетка-миниатюры (для individual)
    // ────────────────────────────────────────────────
    "thumbnails_section": null | {
      "enabled": true,           // ← читает в 0.5
      "preferred_grid_size": 12, // ← читает в 0.5 (примерное N в сетке)
    },
  },
  
  // ==================================================
  // УЧИТЕЛЬСКИЙ РАЗДЕЛ
  // ==================================================
  "teacher_section": null | {
    "enabled": true,             // ← читает в 0.5
    "layout": "two_page" | "one_page",  // ← читает в 0.5
    "show_head_teacher": true,   // ← читает в 0.5
    "max_subjects_per_page": 8,  // ← читает в 0.5
    "right_page_content": "auto_common_photo" | null,  // ← читает в 0.5
  },
  
  // ==================================================
  // ОБЛОЖКА
  // ==================================================
  // В 0.5 builder читает только cover_type
  // financial_mode — это уровень «бизнес-настроек», не вёрстки
  // ==================================================
  "cover_section": {
    "financial_mode": "required"
                   | "optional_paid_visible"
                   | "optional_paid_hidden",  // зарезервировано
    "price": 300,                              // зарезервировано
    
    "cover_type": "portrait_photo"  // ← читает в 0.5
               | "common_photo"
               | "design_only",
    
    "per_student": true,                       // зарезервировано
  },
  
  // ==================================================
  // INTRO (для soft)
  // ==================================================
  "intro_section": null | {
    "type": "single_page",       // ← читает в 0.5
    "with_photo": true,          // зарезервировано
  },
  
  // ==================================================
  // ОБЩИЙ РАЗДЕЛ
  // ==================================================
  // В 0.5 builder НЕ генерирует автоматически (idml-recon §9)
  // Полностью зарезервировано
  // ==================================================
  "common_section": null | {
    "enabled": true,
    "auto_generate": false,
    "vignette": { "enabled": true, "per_student": false },
    "collages": { "enabled": true, "max_count": 4 },
    "class_photo": { "enabled": true },
    "half_class_photos": { "enabled": true, "max_count": 2 },
  },
  
  // ==================================================
  // ПЕРСОНАЛЬНЫЙ РАЗВОРОТ ЗА ДОПЛАТУ
  // ==================================================
  // ЗАРЕЗЕРВИРОВАНО — отдельный модуль, не builder
  // ==================================================
  "personal_spread_addon": null | {
    "enabled": true,
    "price": 1000,
    "min_photos": 6,
    "max_photos": 12,
    "per_student": true,
  },
}
```

---

# ЧАСТЬ 3: Что builder читает в 0.5 (минимум)

Это **только подмножество** полей выше. Всё остальное — ignore.

| Поле | Что делает builder |
|------|-------------------|
| `print_type` (на уровне presets, не config) | Включает intro_section если `soft` и intro задан |
| `student_section.spreads_per_student.max` | Если =1 — обычное поведение. Если >1 — warning (нет мастеров) |
| `student_section.base_layout_mode` | Выбирает какую функцию запустить (single_page / spread / grid) |
| `student_section.first_spread_content.text.enabled` | Включает место под цитату |
| `student_section.first_spread_content.friend_photos.enabled` + `max` | Передаётся в slot_capacity_min при поиске мастеров |
| `student_section.thumbnails_section.enabled` + `preferred_grid_size` | После личного раздела добавляет сетку-миниатюру |
| `teacher_section.enabled` | Запускать ли teacher section |
| `teacher_section.layout` | one_page / two_page (Mini-soft vs обычный) |
| `teacher_section.show_head_teacher` | Включать карточку классрука |
| `teacher_section.max_subjects_per_page` | Лимит при выборе мастера F-* |
| `teacher_section.right_page_content` | auto_common_photo → выбор G-*; null → нет правой страницы |
| `intro_section.type` | single_page → S-Intro мастер |
| `cover_section.cover_type` | portrait_photo / common_photo / design_only — для будущей обложки |

**Всё остальное в config — игнорируется.** Это нормально, в БД они сохраняются на будущее.

---

# ЧАСТЬ 4: Структура таблиц БД

### config_presets

```sql
CREATE TABLE config_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
    -- NULL = глобальный (доступен всем тенантам)
  
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  
  print_type text NOT NULL CHECK (print_type IN ('layflat', 'soft')),
  
  config jsonb NOT NULL,
    -- Богатая структура, см. ЧАСТЬ 2
  
  is_template boolean DEFAULT false,
    -- зарезервировано (для UI «копировать пресет»)
  
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT unique_tenant_slug UNIQUE NULLS NOT DISTINCT (tenant_id, slug)
);

CREATE INDEX idx_config_presets_tenant ON config_presets(tenant_id);
```

### text_templates

В фазе 0.5 эта таблица **создаётся, но не используется builder'ом**. Это «зарезервировано» под будущее.

```sql
CREATE TABLE text_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('free', 'questionnaire', 'quote_catalog')),
  questions jsonb,
  default_max_chars int,
  quotes_filter text,
  CONSTRAINT unique_tenant_slug_text UNIQUE NULLS NOT DISTINCT (tenant_id, slug)
);
```

### albums — изменения

```sql
ALTER TABLE albums
DROP COLUMN config_type,                    -- удаляем enum (был добавлен в 1.0)
ADD COLUMN config_preset_id uuid REFERENCES config_presets(id),
ADD COLUMN template_set_id uuid REFERENCES template_sets(id);
-- print_type оставляем (был добавлен в 1.0, остаётся)
```

**Backfill:** все 9 существующих альбомов имеют `config_type=NULL`. Они получат `config_preset_id=NULL` и `template_set_id=NULL`. UI запросит выбор перед сборкой.

---

# ЧАСТЬ 5: Семантика layout_mode → builder logic

| layout_mode | Что делает builder | Какие мастера ищет |
|---|---|---|
| `single_page_per_student` | По 1 ученику на странице, пары образуют разворот | `page_role IN ('student', 'student_left', 'student_right')` с `students:1` или `students:2` |
| `spread_per_student` | Один ученик = разворот | `page_role IN ('student_left', 'student_right')` с `students:1` |
| `grid_multiple_students` | N учеников на странице (сетка) | `page_role IN ('student_grid_left', 'student_grid_right')` с `students:N` |

3 текущие функции (`buildStandardStudents`, `buildMaximumStudents`, `buildAdaptiveGridStudents` + `buildMediumStudents` для grid с фиксированным размером) обобщаются в **3 функции** по этим режимам.

---

# ЧАСТЬ 6: Миграция текущих 7 пресетов

Seed-файл — после создания таблицы `config_presets` вставляем 7 записей с конкретным config (на основе текущего `SCENARIOS` в коде).

| slug | base_layout_mode | text | friend_photos | thumbnails | print_type | особенности |
|------|------------------|------|---------------|------------|------------|-------------|
| standard | single_page_per_student | enabled | disabled | null | layflat+soft | spreads=1 |
| universal | single_page_per_student | enabled | disabled | null | layflat+soft | как standard, но Left+Right разные |
| maximum | spread_per_student | enabled | enabled max=4 | null | layflat+soft | один = разворот |
| medium | grid_multiple_students | enabled | disabled | null | layflat+soft | N=4 на странице |
| light | grid_multiple_students | disabled | disabled | null | layflat+soft | N=6 |
| mini | grid_multiple_students | disabled | disabled | null | layflat+soft | N=12, soft без intro |
| individual | spread_per_student | enabled | enabled max=3 | enabled (12) | layflat+soft | разворот + сетка миниатюр |

Все 7 — глобальные (`tenant_id=NULL`).

---

# ЧАСТЬ 7: UI в фазе 0.5

UI выбора пресета — **простая** форма в карточке альбома (вкладка «Вёрстка», добавится в фазе 1.3).

Похоже на текущую форму создания альбома:
- 4 кнопки готовых пресетов: «Универсал», «Индивидуальный», «Медиум», «Фотопапка/Мини/Лайт»
- Текстовое поле «Стандарт, Расширенный...» — выбор по slug

Никаких «конструкторов», галочек, расширенных настроек. Это всё **зарезервировано** для будущей фазы (партнёрский конструктор).

---

# ЧАСТЬ 8: Этапы реализации

| Подэтап | Что | Объём |
|---|---|---|
| 0.5.0 | Эта спека | Готова |
| 0.5.1 | Миграция БД: `config_presets`, `text_templates`, FK в albums, удалить config_type | ~1 ч |
| 0.5.2 | TypeScript-типы Preset, миграция SCENARIOS из кода в seed-данные БД | ~2.5 ч |
| 0.5.3 | Рефакторинг buildAlbum: принимает Preset, выбирает функцию по base_layout_mode | ~3 ч |
| 0.5.4 | Адаптация 58 smoke-сцен под новую модель (через JSON-config вместо config_type enum) | ~2 ч |
| 0.5.5 | Endpoint build_album_test — обновить input под Preset | ~1 ч |
| 0.5.6 | Контекст v40 + обновление phase-1-spec | ~30 мин |
| **Итого** | | **~10 часов** |

После 0.5 фаза 1 (loadAlbumInput, build_album_real, UI «Вёрстка», bulk-тестирование):
- Фаза 1.3 (UI «Вёрстка») использует выбор пресета (dropdown)
- Объём ~10-12 ч (как было)

---

# ЧАСТЬ 9: Что НЕ входит в фазу 0.5

- UI редактора пресетов (фаза «партнёрский конструктор» — позже)
- UI редактора `text_templates` (позже)
- Builder обработка `additional_spreads` (отдельная фаза)
- Builder обработка `personal_spread_addon` (отдельный модуль продукта)
- Builder обработка `common_section` (idml-recon §9 — отложено в фазу N)
- per_student обработка обложки (отдельная фаза)
- Множественные text режимы (free + quote_catalog) (отдельная фаза)
- Версионирование пресетов (заморозка snapshot в `album_layouts.config_snapshot`) — добавим если будут проблемы

---

# ЧАСТЬ 10: Открытые вопросы (на согласование)

### 1. Backfill 9 существующих альбомов

Все имеют `config_type=NULL`. После 0.5.1 они получат `config_preset_id=NULL`.

**Что делать в UI:**
- В вкладке «Обзор»: «Конфигурация не задана» (как сейчас в 1.0)
- В вкладке «Вёрстка» (фаза 1.3): форма выбора пресета перед сборкой

**Никакого автоматического backfill.** Партнёр сам выберет пресет когда захочет собирать.

### 2. text_templates — создавать в 0.5 или отложить?

**Вариант A:** создаём таблицу в 0.5 (но builder не использует). Готовим почву.

**Вариант B:** не создаём, отложим до фазы когда понадобится.

Я склоняюсь к **A** — лучше иметь схему готовой. Если в фазе 1 (smart-fill) поймём что нужно — уже есть таблица.

### 3. Версионирование пресетов

Если партнёр меняет пресет после привязки к альбому — что со старыми альбомами?

**Простое решение для 0.5:** не делаем версионирование. Если пресет изменился — следующая пересборка использует новую версию. Старая в `album_layouts` (если уже сохранена) остаётся как есть.

В будущем (если будет проблема) — добавим snapshot config в `album_layouts`.

### 4. Что делать со spreads_per_student.max > 1

В builder'е обнаруживается такое значение — что:
- **Вариант X:** warning «нет мастеров» + используется max=1 (graceful degradation)
- **Вариант Y:** error «дополнительные развороты не поддерживаются» (стоп)

Я склоняюсь к **X** — это проявление принципа «богатая БД, простая логика». Поле есть, но builder в 0.5 берёт только max=1 и предупреждает.

---

# ЧАСТЬ 11: Что я хочу от Сергея

1. **Прочитать v3 целиком**
2. **Согласие/правки** по части 2 (полная схема config) — что добавить/убрать
3. **Ответы на 4 открытых вопроса** в части 10
4. После итерации — **стартуем 0.5.1**

Сегодня цель: довести спеку до состояния «можно делать код».
