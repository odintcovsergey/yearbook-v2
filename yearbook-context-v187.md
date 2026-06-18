# КОНТЕКСТ ДЛЯ ПРОДОЛЖЕНИЯ РАБОТЫ
# Система отбора фотографий для выпускных альбомов → платформа для школьных фотографов
# Версия: v187
# Обновлено: 18.06.2026 (обложки: привязка к дизайну, фон при обложке, выбор в заказе, превью; фикс 413)
#
# Предыдущий контекст: yearbook-context-v186.md (история не переписывается).

---

## Контекст задачи

ТЗ tz-cover-connect-to-order (заменил черновик tz-cover-connect-to-order). Обложки
были раздвоены и не связаны: cover-мастера грузились в глобальную свалку
/super/covers (без template_set_id), фоны обложки — отдельным списком в
template_set_backgrounds (category cover). Плюс большой IDML обложек (~8 МБ) падал
с HTTP 413. Это ТЗ всё консолидирует. Сделано на ветке `feat/cover-connect-to-order`.

ВАЖНО: бóльшая часть слоя сборки обложки УЖЕ существовала (loadAlbumCovers,
assembleCovers, buildAlbumCoverPreviews, spine, layout, preview-svg; таблица covers
с полями template_set_id + background_url; блок «Обложка» в заказе). Это ТЗ — в
основном проводка + UI + три дельты.

## Согласованная модель

- Родные обложки дизайна: covers.template_set_id заполнен, is_global=false, видны
  только своему дизайну.
- Дизайнерские (библиотека): is_global=true, template_set_id=null, для любого дизайна.
- Фон — при КАЖДОЙ обложке (covers.background_url), не списком в дизайне, не в IDML.

## ✅ DONE (5 этапов, ветка не в main)

**Миграция (ПРИМЕНЕНА Сергеем 18.06.2026):** `2026-06-18-covers-template-set-scope.sql`
— covers_scope_slug_uniq: уникальность slug в рамках (tenant, template_set), чтобы
родная обложка дизайна не сталкивалась с одноимённой в библиотеке.

1. **Загрузка в дизайн** — `lib/cover/upload-covers.ts`: meta.templateSetId →
   template_set_id заполнен, is_global=false; force-replace в рамках дизайна.
   Карточка дизайна (`app/super/templates/[id]/page.tsx`) → блок `CoverDesignPanel`
   (список родных обложек + загрузка в дизайн + публикация/удаление + фон).
   /super/covers — дизайнерская библиотека (GET `scope=library`).
2. **Фон при обложке** — API covers: `bg_sign`/`bg_commit`/`bg_clear` (bucket
   `template-backgrounds`, путь `covers/<id>/<uuid>.<ext>`); `CoverBackgroundButton`
   + хелпер `coverBackground.ts` (sign→PUT→commit, supabaseBrowser.uploadToSignedUrl).
   Кнопка фона в библиотеке и в карточке дизайна. Категория «Обложка» убрана из
   панели фонов дизайна; `pageRoleToCategory('cover')` → null.
3. **Фикс 413** — IDML обложек грузится presigned (upload_type 'idml', YC,
   template-imports/) → `/api/covers?action=import` JSON `{storage_key,...}` качает
   из хранилища и парсит. `CoverUploadModal` переписан на 3 шага + проп templateSetId.
   Multipart-путь оставлен (legacy/мелкие).
4. **Выбор в заказе** — `/api/tenant covers_list`: область = родные дизайна
   (template_set_id) + по include_global ещё и дизайнерские. Блок «Обложка» в заказе
   (`app/app/page.tsx`): список под выбранный дизайн, кнопка «Показать дизайнерские»,
   подписи «родная»/«дизайнерская».
5. **Превью** — `lib/cover/preview-svg.ts`: фон на полотно (`background_url`), декор
   under/over/foreground, скрытие пустых слотов (`hide_empty_slots`). `preview-album`
   прокидывает фон + hide_empty_slots; `parent-gallery` тоже отдаёт background_url.

## Проверки

- `npx tsc --noEmit` — чисто.
- `npx vitest run` — 1016 passed (новые тесты: templateSetId в buildCoverRow;
  фон/скрытие пустых/декор в preview-svg; cover→null в resolve-background).
- `npx next build` — зелёный.

## 🚩 НЕ сделано / следующий шаг

- **Вживую НЕ прокликано.** Нужен прогон на preview-ссылке: загрузить обложки в
  дизайн (8-МБ IDML — проверить, что 413 ушёл), повесить фон, в заказе выбрать
  родные + «дизайнерские», открыть превью (фон+слоты+декор+корешок).
- **3 старых cover-фона** из template_set_backgrounds(category=cover) НЕ перенесены
  автоматически — перезалить через новую кнопку «Загрузить фон» при обложке.
- Границы (отдельные ТЗ): редактор обложки (ручная правка), экспорт в печать
  (склейка полотна, имена K-00/000-00, водяной знак, форматы), доплата родителя
  за персональную обложку (сейчас только режим parent_choice в данных).
- Старая система обложки (cover_mode/cover_selections) — снос отдельным ТЗ
  (см. память project_cover_design).
