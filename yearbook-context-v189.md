# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v189
# Обновлено: 18.06.2026 (сущность «Типография»: типы листов + диапазоны корешка)
#
# Предыдущий контекст: yearbook-context-v188.md (история не переписывается).

---

## Контекст задачи

ТЗ tz-printer-entity (заменил неудачный подход «толщина листа» из v188 — Сергей
этих данных не имеет). Корешок задаётся по-человечески: типография → типы листов
→ диапазоны «от N до M разворотов → корешок X мм». Это же основа будущего профиля
типографии для экспорта. Прошлая ветка feat/print-preset (толщина) УДАЛЕНА (не в main).

## Иерархия

```
Типография (printers) — глобальная (tenant_id=null) применяется к любому заказу
 └─ Тип листа (config.sheet_types[]: {id, name})
     └─ Диапазон (spine_ranges[]: {min_spreads, max_spreads, spine_mm}) — границы свободные
```

## ✅ DONE (ветка feat/printers, НЕ в main)

**Миграция (нужно применить Сергею):** `2026-06-18-printers.sql` — таблица
`printers` (id, tenant_id, is_global, name, config jsonb) + `albums.printer_id`
(FK). Аддитивно. Также продублировано в schema.sql.

- **lib/printers/**: types.ts (SpineRange/PrinterSheetType/PrinterConfig/Printer),
  spine.ts `resolveSpineFromRanges(config, sheetTypeId, spreadCount) → mm|null`
  (тип листа не задан → первый; вне диапазонов → null; границы включительны).
  Тест __tests__/spine.test.ts (8 кейсов).
- **API** `app/api/super/printers/route.ts` (superadmin): GET список глобальных,
  POST create/update/delete, валидация config (sheet_types/диапазоны, min≤max, ≥0).
- **API** `/api/tenant?action=printers_list` — типографии (глобальные+свои) для заказа.
- **Корешок**: `lib/cover/load-covers.ts loadSpineWidth` переписан — читает
  album.printer_id → printers.config → countAlbumSheets(layout) → resolveSpineFromRanges.
  Старый путь (config_presets.print_spec, толщина) больше НЕ используется
  (функции PrintSpec/computeSpineWidthMm остались, но не вызываются; countAlbumSheets
  из album-spine.ts по-прежнему нужен).
- **Заказ**: albums.printer_id в insert+update-whitelist (/api/tenant); FormData
  printer_id (load/save); блок «Обложка» — вместо «Пресет печати» теперь
  «Типография» + «Тип листа» (app/app/page.tsx).
- **UI** `app/super/printers/page.tsx` + пункт «Печать» (Printer) в SuperSidebar:
  список типографий, добавить типографию, внутри — типы листов, внутри — таблица
  диапазонов (от/до разворотов + корешок мм). Толщины/вылетов НЕТ.

## Цепочка, чтобы корешок посчитался

1. «Печать» → добавить типографию → тип листа → 2–3 диапазона (от/до/корешок).
2. В заказе блок «Обложка» → выбрать типографию (+ тип листа).
3. У альбома должен быть СОХРАНЁННЫЙ макет (album_layouts.spreads) — иначе число
   разворотов неизвестно (countAlbumSheets) → корешок null.
4. «Превью обложки»: корешок = из диапазона, в который попало число разворотов.

## Проверки

- tsc чисто, vitest 1024 passed (новый spine.test для диапазонов), next build зелёный.
- ВАЖНО: после `npx next build` на ветке могли остаться stale `.next/types` от
  удалённого print-presets — это не реальные ошибки, чистятся пересборкой.

## 🚩 Следующий шаг

- Применить миграцию printers; прогон на preview: завести типографию с диапазонами
  → выбрать в заказе → проверить корешок в превью (меняется при разном числе
  разворотов; вне диапазонов — подсказка). Затем merge в main.
- Будущее (эпик tz-print-export-system): в printers.config добавятся формат блока,
  bleed, safe-зона, dpi, режим приёма (разворотами/постранично), схема именования —
  БЕЗ миграции (jsonb расширяемый). Сейчас НЕ реализовано (нет данных опросника).
