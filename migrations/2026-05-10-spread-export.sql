-- Подэтап 3.9.3 — флаг spread_export в export_profiles.
--
-- Контекст: после первого боевого PDF-экспорта (фаза 3.7-3.8) Сергей
-- спросил почему PDF постранично, а не разворотами. Это feature
-- которая нужна для:
--
--   - Layflat альбомов в типографии: некоторые типографии принимают
--     PDF spreads (каждый разворот одной широкой страницей), потому
--     что layflat печатается на одном листе без шва
--   - Превью клиенту: приятнее листать как настоящую книгу
--
-- Стандарт InDesign Export PDF имеет такой же чекбокс «Spreads».
-- Дефолт (false) — pages, как в текущей реализации.
--
-- Изменения:
--   1. ALTER TABLE export_profiles + spread_export boolean
--   2. UPDATE okeybook-client-preview SET spread_export=true
--      (для preview профиля имеет смысл показывать разворотами;
--      для okeybook-print оставляем false — типография стандартно
--      ожидает pages)

ALTER TABLE export_profiles
  ADD COLUMN IF NOT EXISTS spread_export boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN export_profiles.spread_export IS
  'true = двухстраничные мастера экспортируются одной широкой PDF-страницей (spread); false = разрезаются на 2 PDF-страницы (pages, для типографии)';

-- Превью для клиента — разворотами (как в реальной книге)
UPDATE export_profiles
SET spread_export = true
WHERE slug = 'okeybook-client-preview';
