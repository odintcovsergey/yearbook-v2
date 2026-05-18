-- Фаза РЭ.21.1 — добавление колонки presets.section_structure.
--
-- Контекст: после rollback'а РЭ.20.6.3 (e82ea73) перерабатываем
-- архитектуру общего раздела. Новое направление подтверждено Сергеем
-- 18.05.2026 в обсуждении инвентаризации docs/album-structure-inventory.md:
--
-- Структура альбома хранится в БД у пресета как массив СЕКЦИЙ, и партнёр
-- редактирует её через UI (планируется в РЭ.12). Каждая секция имеет тип
-- (soft_intro / teachers / students / common / vignette / soft_final) и,
-- если применимо, массив слотов (например, у common: ["H", "flex_A", ...]).
--
-- Слоты бывают:
--   - H, Q, FULL — фиксированные (один мастер + одна категория фото)
--   - flex_A, flex_B, flex_C — с встроенной цепочкой попыток
--     (см. docs/album-structure-inventory.md §5)
--
-- Партнёр НЕ создаёт свои цепочки — он только перетасовывает имеющиеся
-- типы слотов в нужном порядке (Вариант А из обсуждения 18.05).
--
-- На этой миграции мы добавляем ТОЛЬКО колонку. Без CHECK constraint
-- (схема ещё не финальная — может меняться по мере проектирования UI).
-- Без дефолтных значений: NULL означает «использовать старую логику»
-- (текущие правила rule engine по priority). Это безопасно — существующий
-- build engine не читает новое поле, ничего не ломается.
--
-- Наполнение дефолтами по комплектациям (из build_album.jsx mandSlots/
-- addSlots) — отдельный шаг РЭ.21.2 после согласования финальной формы.
-- UI редактирования — РЭ.12.
--
-- Миграция аддитивная. Применить в Supabase SQL Editor.

ALTER TABLE presets
  ADD COLUMN IF NOT EXISTS section_structure jsonb;

COMMENT ON COLUMN presets.section_structure IS
  'РЭ.21: структура альбома данного пресета. Массив секций — каждая секция со своим типом (soft_intro / teachers / students / common / vignette / soft_final) и опциональным массивом slots. См. docs/album-structure-inventory.md. NULL = использовать legacy-логику rule engine (priority-based правила).';

-- Проверочный запрос (выполнить после миграции):
-- SELECT id, display_name, section_structure FROM presets ORDER BY id;
-- Ожидание: 7 строк, у всех section_structure = NULL.
