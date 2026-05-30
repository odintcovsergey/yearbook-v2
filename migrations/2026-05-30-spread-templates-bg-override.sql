-- Система категорийных фонов с ротацией — Этап 1б: override фона на уровне мастера.
--
-- Контекст:
--   Иногда конкретному мастеру (spread_template) нужен СВОЙ фиксированный фон,
--   игнорируя ротацию категории. Например интро/обложка с уникальной картинкой.
--
-- Решение:
--   Колонка background_override_url. Если задана — движок берёт её для разворота,
--   где этот мастер ведущий, минуя ротацию категории.
--
-- Приоритет выбора фона на разворот (сверху вниз):
--   1. album override   — партнёр сменил фон вручную в редакторе (хранится в
--                         album_layouts.spreads[].data как ключ __bg__, БЕЗ миграции);
--   2. master override  — ЭТА колонка (background_override_url);
--   3. ротация категории (template_set_backgrounds);
--   4. default_background_url (fallback);
--   5. без фона.
--
-- DEFAULT NULL:
--   NULL = нет override, работает ротация категории. Существующие мастера не
--   затрагиваются. Откат — drop column.

alter table spread_templates
  add column if not exists background_override_url text;

-- Проверка после миграции:
-- SELECT id, name, background_override_url FROM spread_templates LIMIT 5;
-- (колонка присутствует, у всех NULL)
