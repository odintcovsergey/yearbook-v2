-- РЭ.37.6 — Ручной сценарий переходного раздела (custom transition scenario).
--
-- Контекст:
-- По умолчанию engine использует OkeyBook-логику для transition-разворота
-- (см. lib/rule-engine/sections/transition.ts → fillOkeybookDefault):
-- автоматически определяет комплектацию по последней students-странице,
-- выбирает combo-мастер и закрывающий мастер. Это работает для большинства
-- случаев.
--
-- Но иногда партнёр хочет ВРУЧНУЮ задать что именно класть на хвостовой
-- разворот — например, использовать combo-мастер другого размера или
-- свой кастомный мастер, который engine по умолчанию не подхватывает.
-- Эта колонка позволяет такой override.
--
-- Структура JSONB:
--   NULL                      → используется OkeyBook-default (старое поведение)
--   { "mode": "default" }     → используется OkeyBook-default (то же что NULL,
--                               но явно)
--   { "mode": "custom",
--     "tail_left_master_id":  uuid|null,   -- мастер для левой страницы
--                                             transition-разворота. NULL =
--                                             оставить students-страницу как
--                                             есть (без замены).
--     "tail_right_master_id": uuid|null,   -- мастер для правой страницы.
--                                             NULL = skip правую (закрыть
--                                             через J-цепочку как обычно).
--     "closing_master_id":    uuid|null    -- РЕЗЕРВ для будущего: если в
--                                             РЭ.37.6.* добавим поддержку
--                                             полного контроля над closing.
--                                             Пока игнорируется engine'ом.
--   }
--
-- В custom-режиме:
--   • Симметризация хвоста ИГНОРИРУЕТСЯ (партнёр сам решил что на хвосте).
--     В UI галка «Симметризировать хвост» становится disabled с пояснением.
--   • detectComplectation не вызывается (не нужен — мы используем явные
--     master_id из JSON).
--   • Адаптивный хвост students.ts по-прежнему работает (это про сам
--     students-раздел, не про transition).
--
-- Валидация structure через CHECK constraint:
--   • Если mode='custom' — должно быть хотя бы одно из *_master_id не NULL
--     (иначе скрипт не имеет смысла).
--   • mode может быть только 'default' или 'custom'.
--   • Сами master_id мы НЕ проверяем FK-constraint'ом — мастера могут быть
--     удалены/добавлены в template_set независимо. Если master_id из
--     JSON отсутствует в template_set на момент сборки — engine добавит
--     warning transition_custom_master_not_found.
--
-- Совместимость:
--   NULL DEFAULT для всех существующих пресетов → старое поведение
--   (OkeyBook-default). Старый код, не знающий про колонку, не ломается.
--
-- См. также:
--   yearbook-context-v165.md (план РЭ.37.6)

ALTER TABLE presets
  ADD COLUMN IF NOT EXISTS transition_scenario JSONB NULL;

-- Опциональная валидация структуры JSON. Проверяет только верхнеуровневую
-- структуру: mode должен быть валидным, и если mode='custom' — хотя бы
-- один master_id должен быть задан. Это защита от мусора в JSON; engine
-- всё равно делает свою проверку при чтении.
ALTER TABLE presets
  ADD CONSTRAINT presets_transition_scenario_valid
  CHECK (
    transition_scenario IS NULL
    OR (
      jsonb_typeof(transition_scenario) = 'object'
      AND (transition_scenario->>'mode') IN ('default', 'custom')
      AND (
        (transition_scenario->>'mode') = 'default'
        OR (
          -- В custom-режиме хотя бы один из master_id должен быть не NULL.
          (transition_scenario->>'tail_left_master_id') IS NOT NULL
          OR (transition_scenario->>'tail_right_master_id') IS NOT NULL
          OR (transition_scenario->>'closing_master_id') IS NOT NULL
        )
      )
    )
  );

COMMENT ON COLUMN presets.transition_scenario IS
  'РЭ.37.6: ручной сценарий transition-разворота. NULL = OkeyBook-default. ' ||
  'Иначе JSONB {mode: "default"|"custom", tail_left_master_id, ' ||
  'tail_right_master_id, closing_master_id}.';

-- Проверка после применения:
--   SELECT id, display_name, transition_scenario FROM presets ORDER BY id;
-- Ожидание: у всех пресетов transition_scenario IS NULL.
