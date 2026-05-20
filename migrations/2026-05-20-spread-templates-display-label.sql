-- РЭ.23.1: добавление колонки display_label для человеко-читаемого
-- названия мастера.
--
-- Контекст:
-- После РЭ.22 у мастеров есть технические имена (S-Intro, M-Grid-Page,
-- F-Head-LargeGrid и т.д.) и семантические теги (page_role + slot_capacity).
-- Но человеку (партнёру или админу) технические имена не объясняют что
-- именно за вариант layout'а. В РЭ.23 добавляем display_label — короткое
-- описание для UI: «Вариант 4: четыре ученика», «Главный учитель + 8
-- предметников», «Обложка с двумя общими фото на задней стороне» и т.д.
--
-- В РЭ.23.4 страница /super/master-catalog даст возможность Сергею
-- проставить display_label всем мастерам OkeyBook через inline-редактор.
-- В РЭ.24/25 партнёры будут видеть display_label вместо name.
--
-- Колонка опциональна (NULL допустим). UI делает fallback на `name`
-- когда display_label не заполнен — нулевой риск для существующих
-- записей.
--
-- ⚠️ ВАЖНО: миграция добавляет колонку, никаких UPDATE'ов.
-- Все existing мастера получают display_label=NULL, что означает
-- «использовать name в UI».

ALTER TABLE spread_templates
ADD COLUMN IF NOT EXISTS display_label TEXT NULL;

COMMENT ON COLUMN spread_templates.display_label IS
  'Человеко-читаемое название мастера для UI (РЭ.23). Например '
  '"Вариант 4: четыре ученика". Когда NULL — UI показывает name '
  'как fallback.';

-- ─── Проверка после применения ────────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'spread_templates' AND column_name = 'display_label';
--
-- Ожидание: одна строка, display_label / text / YES.
