-- РЭ.21.6.1 — связь пресета с дизайном (template_set).
--
-- Контекст: пресет (комплектация) описывает СТРУКТУРУ альбома —
-- какие секции, сколько страниц, какие слоты в общем разделе.
-- Но как эти слоты выглядят визуально — определяется template_set'ом
-- (набором IDML-мастеров). Сейчас в коде хардкод 'okeybook-default'
-- (3 места в app/api/layout/route.ts).
--
-- После этой миграции:
--   - Пресет может хранить ссылку на конкретный template_set.
--   - Партнёр в форме создания пресета выбирает дизайн из доступных.
--   - loadBundle получает slug из пресета (с фолбэком на okeybook-default
--     для пресетов с NULL — это все 8 текущих).
--
-- Безопасность миграции:
--   - ADD COLUMN nullable, без NOT NULL → существующие пресеты не ломаются.
--   - ON DELETE SET NULL → удаление template_set'а не каскадит на пресет
--     (пресет остаётся, но «теряет» дизайн → фолбэк на okeybook-default).
--   - По правилам РЭ.21.5.3-инцидента (см. context v83): ADD COLUMN
--     применяем СНАЧАЛА в БД, ПОТОМ деплоим код. Это безопасно: старый
--     код просто не видит новую колонку.
--
-- Используем UUID (template_sets.id), а НЕ slug:
--   - slug уникален только в паре (tenant_id, slug), не глобально
--     (см. template-sets-slug-migration.sql — partial unique index).
--   - FK на text-колонку без уникальности невозможен.
--   - UUID — стабильнее: переименование slug партнёром не сломает связь.

ALTER TABLE presets
  ADD COLUMN template_set_id uuid REFERENCES template_sets(id) ON DELETE SET NULL;

-- Индекс для будущих JOIN'ов: «все пресеты использующие этот дизайн».
CREATE INDEX idx_presets_template_set ON presets(template_set_id) WHERE template_set_id IS NOT NULL;

COMMENT ON COLUMN presets.template_set_id IS
  'Какой template_set (дизайн/набор IDML-мастеров) использовать при сборке альбома. NULL = фолбэк на глобальный okeybook-default. Заполняется партнёром в форме создания пресета (РЭ.21.6).';

-- Проверка после применения:
--   SELECT id, display_name, template_set_id FROM presets ORDER BY id;
-- Ожидание: 8 строк, у всех template_set_id = NULL (фолбэк на okeybook-default).
