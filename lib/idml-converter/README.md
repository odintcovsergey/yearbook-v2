# lib/idml-converter

Серверный парсер IDML (Adobe InDesign Markup Language) → JSON-структура шаблона альбома.

> **Архитектурные решения и формат IDML — см. `docs/templates/idml-recon-notes.md`, §6.**
> Этот README — практическая шпаргалка по API.

---

## Использование

```ts
import { parseIdml } from '@/lib/idml-converter/parse';

// Принимает Uint8Array или Buffer (multipart upload, fs.readFile, fetch.arrayBuffer).
const buffer = await fs.promises.readFile('Плотные_Мастер_Белый.idml');
const result = await parseIdml(buffer);

console.log(result.page_width_mm, result.page_height_mm); // 226 288
console.log(result.spread_templates.length);              // 39
console.log(result.warnings);                             // ParserWarning[]
```

## Что возвращает

`Promise<ParsedTemplateSet>` — см. `types.ts`. Главные поля:

- `page_width_mm`, `page_height_mm` — размеры одной страницы.
- `spread_width_mm`, `spread_height_mm` — размеры разворота.
- `bleed_mm` — bleed (максимум по 4 сторонам).
- `facing_pages`, `page_binding` — флаги документа.
- `spread_templates: ParsedSpreadTemplate[]` — все мастер-страницы.
- `warnings: ParserWarning[]` — предупреждения по всему набору (дубли label'ов, мастера без имени, фреймы без меток и т.п.). Собираются на верхнем уровне для UI просмотрщика `/super/templates`.

`ParsedSpreadTemplate.placeholders: Placeholder[]` — массив `PhotoPlaceholder | TextPlaceholder | OvalPlaceholder` с координатами в mm от верхнего-левого угла разворота.

## Статус реализации (фаза 0)

| Коммит | Что добавлено |
|---|---|
| 0.2.1 | Распаковка zip, Preferences (размеры/bleed/facing), скелет цикла по MasterSpreads. `placeholders = []`. |
| 0.2.2 | `extract-geometry.ts` — координаты Rectangle/Oval/TextFrame, lowercase-нормализация label'ов, `_left`/`_right` суффиксы при коллизиях, rotation. |
| 0.3   | `extract-styles.ts` — стили текста из Stories/Styles. |

Запись в БД и CLI — отдельные коммиты (0.4), API multipart-загрузки — 0.6.

## Отладка

Воспроизводимая sanity-проверка против реального шаблона — `scripts/dev/parse-test.ts` (добавляется в 0.2.2). Сверяет ключевые координаты с эмпирическими значениями из `idml-recon-notes.md` §3.
