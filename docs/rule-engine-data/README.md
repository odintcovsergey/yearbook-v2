# Rule Engine — JSON-каталог глобальных данных

Источник правды для rule engine. Эти файлы определяют семейства, правила и пресеты которые подгружаются в БД через `scripts/seed-rule-engine.ts`.

**Применять изменения в БД**: после редактирования любого файла здесь нужно прогнать seed-скрипт. Он валидирует данные через Zod и (в РЭ.8+) выполняет UPSERT в Supabase.

## Структура папок

```
families/              # 7 семейств (template_families.id → файл)
  head-teacher.json
  subject-teachers.json
  class-photo.json
  student-section.json    # с density_config и пятью параметрами
  common-section.json
  intro.json
  final.json

rules/                 # правила выбора мастера (rules.id → файл)
  (наполняется в РЭ.4-РЭ.7)

presets/               # 7 базовых пресетов (presets.id → файл)
  standard.json
  universal.json
  maximum.json
  individual.json      # две секции student-section (max + mini), новый в v1.1
  medium.json
  light.json
  mini-soft.json
```

## Соответствие схемам

- `families/*.json` → `TemplateFamilySchema` (lib/rule-engine/schemas.ts)
- `rules/*.json` → `RuleSchema`
- `presets/*.json` → `PresetSchema`

## Валидация

```bash
npx tsx scripts/seed-rule-engine.ts
```

Проверяет:
1. Каждый файл валиден против Zod-схемы (.strict() — никаких лишних полей)
2. `rules.family_id` ссылается на существующее семейство в families/
3. `presets.sections[].family_id` ссылается на существующее семейство
4. Параметры секции пресета (`has_quote`, `has_friend_photos`, `friend_photos_max`) совместимы с указанной `density` согласно матрице §4.4 spec'а

## Семь активных семейств

| ID | Что делает | Состав мастеров (postpage) |
|---|---|---|
| `head-teacher` | Левая (layflat) или единственная (soft) страница с классруком | F-Head-WithPhoto, F-Head-SmallGrid, F-Head-LargeGrid, F-Head-WithClassPhoto-L |
| `subject-teachers` | Правая страница при subjects ≥ 9 | G-Teachers-3x3, G-Teachers-4x3, G-Teachers-4x4 |
| `class-photo` | Правая страница при subjects ≤ 8 | G-FullClass, G-HalfClass |
| `student-section` | Личный раздел с параметром density | E-Max-*, E-Universal-*, E-Standard-*, M-Grid-*, L-Grid-*, N-Grid-* |
| `common-section` | Общий раздел | J-Spread, J-Full, J-Half, J-Quarter, J-Collage-*, J-Quote |
| `intro` | Заглавный (только soft) | S-Intro |
| `final` | Финальный (только soft) | S-Final-Soft-L |

I-Personal удалено — функция выполняется через `student-section` с `density=maximum` в пресете «Индивидуальный».

## Семь базовых пресетов

| ID | Печать | Секции |
|---|---|---|
| `standard` | layflat | head-teacher → student-section(standard, has_quote) → common-section |
| `universal` | layflat | head-teacher → student-section(universal, has_quote, has_friend_photos=4) → common-section |
| `maximum` | layflat | head-teacher → student-section(maximum, has_quote, has_friend_photos=4) → common-section |
| `individual` | layflat | head-teacher → student-section(maximum, …) → student-section(mini) → common-section |
| `medium` | layflat | head-teacher → student-section(medium) → common-section |
| `light` | layflat | head-teacher → student-section(light) → common-section |
| `mini-soft` | soft | intro → head-teacher → student-section(mini) → common-section → final |

Партнёры будут копировать эти пресеты в свой `tenant_id` и редактировать — порядок секций, плотности, параметры.
