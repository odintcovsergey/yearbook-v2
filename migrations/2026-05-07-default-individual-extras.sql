-- Миграция 0.11.3 (дополнение) — расширение default_for_configs
-- для общеупотребимых F-Head-*, G-* и S-Intro мастеров чтобы они
-- автоматически выбирались в Индивидуальном (как и в других комплектациях).

UPDATE spread_templates
SET default_for_configs = ARRAY['standard','universal','maximum','medium','light','mini','individual']
WHERE template_set_id = (SELECT id FROM template_sets WHERE slug = 'okeybook-default')
  AND name IN (
    'F-Head-WithPhoto', 'F-Head-SmallGrid', 'F-Head-LargeGrid',
    'G-FullClass', 'G-HalfClass',
    'G-Teachers-3x3', 'G-Teachers-4x3', 'G-Teachers-4x4',
    'S-Intro'
  );
