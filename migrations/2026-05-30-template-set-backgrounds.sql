-- Система категорийных фонов с ротацией — Этап 1а: таблица пула фонов.
--
-- Контекст:
--   Раньше фон был ОДИН на весь template_set (template_sets.default_background_url).
--   Для дизайнов вроде «Акварельных мечт» этого мало: разным разделам альбома
--   нужны разные фоны, а внутри длинного личного раздела (15 разворотов подряд)
--   фоны должны меняться по кругу (ротация), а не повторять одну картинку.
--
-- Решение:
--   Пул фонов по КАТЕГОРИЯМ. Движок подставляет фон по роли страницы
--   (page_role → категория) и ротирует несколько фонов внутри категории.
--   Стартовые категории: intro / teacher / student / student_grid / common /
--   final / cover.
--
-- category — ТЕКСТ, а НЕ enum и НЕ CHECK:
--   чтобы добавлять/убирать категории в будущем без миграции схемы. Список
--   допустимых категорий живёт в коде (lib/backgrounds/page-role-to-category.ts),
--   а не в БД.
--
-- side — на какой части разворота применять фон:
--   'spread' — цельная картинка на весь разворот (режется пополам через sharp),
--   'left'/'right' — для постраничных фонов, 'any' — подходит куда угодно.
--
-- url — путь файла внутри уже существующего bucket template-backgrounds
--   (создан миграцией 2026-05-28-template-backgrounds-bucket.sql). Переиспользуем.
--
-- Совместимость:
--   default_background_url остаётся как fallback. Если у категории нет фонов —
--   движок берёт default_background_url, если и его нет — без фона (как сейчас).
--   Простые дизайны («Белый», один фон на всё) продолжают работать без изменений.

create table if not exists template_set_backgrounds (
  id              uuid primary key default gen_random_uuid(),
  template_set_id uuid not null references template_sets(id) on delete cascade,
  category        text not null,                    -- 'intro'/'teacher'/'student'/... (текст, НЕ enum)
  url             text not null,                    -- путь в bucket template-backgrounds
  sort_order      int  not null default 0,          -- порядок в ротации внутри категории
  side            text not null default 'spread',   -- 'spread'/'left'/'right'/'any'
  created_at      timestamptz default now()
);

-- Индекс под основной запрос: «все фоны набора, сгруппированные по категории,
-- в порядке ротации».
create index if not exists idx_tsb_set_cat_order
  on template_set_backgrounds (template_set_id, category, sort_order);

-- Проверка после миграции:
-- SELECT * FROM template_set_backgrounds;   -- должно быть пусто, без ошибок
