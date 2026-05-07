-- Семантические теги для мастеров (подэтап 0.8.6)
-- Дата: 2026-05-06
-- Цель: позволить выбирать мастера в album-builder по семантике, а не по имени.
-- См. yearbook-context-vN.md и обсуждение на сессии 06.05.2026.

ALTER TABLE spread_templates
  ADD COLUMN applies_to_configs text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN page_role text,
  ADD COLUMN slot_capacity jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN is_fallback boolean DEFAULT false,
  ADD COLUMN mirror_for_soft boolean DEFAULT false,
  ADD COLUMN audit_notes text;

-- Индексы для быстрого поиска при выборе мастера в album-builder
CREATE INDEX idx_spread_templates_page_role
  ON spread_templates(page_role)
  WHERE page_role IS NOT NULL;

CREATE INDEX idx_spread_templates_applies_to_configs
  ON spread_templates USING GIN(applies_to_configs);

-- Комментарии к колонкам для будущих читателей
COMMENT ON COLUMN spread_templates.applies_to_configs IS
  'Массив комплектаций к которым подходит мастер: standard | universal | maximum | medium | light | mini | individual | tryumo. Может быть несколько одновременно. Партнёры могут добавлять новые значения.';

COMMENT ON COLUMN spread_templates.page_role IS
  'Семантическая роль на странице: student | student_grid | student_overflow | student_last | teacher_left | teacher_right | common | intro | cover';

COMMENT ON COLUMN spread_templates.slot_capacity IS
  'JSON со сколькими данными вмещает мастер. Примеры: {"students": 2}, {"teachers": 16}, {"photos_half": 2}. Ключи: students, teachers, photos_full, photos_half, photos_quarter, photos_sixth, photos_friend.';

COMMENT ON COLUMN spread_templates.is_fallback IS
  'true если мастер используется как fallback когда специализированный не найден (например E-Student-Default)';

COMMENT ON COLUMN spread_templates.mirror_for_soft IS
  'true если это зеркальный -R мастер для редкого случая Мини+мягкие листы (где первая страница = правая)';

COMMENT ON COLUMN spread_templates.audit_notes IS
  'Свободные заметки от семантического аудита: нужно переделать, странности, плановые изменения';
